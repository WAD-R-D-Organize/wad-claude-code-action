#!/usr/bin/env bun

/**
 * Git submodule detection and branch management
 * Provides functionality to detect submodules and create corresponding branches
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import type { Octokits } from "../api/client";

export type SubmoduleInfo = {
  name: string;
  path: string;
  url: string;
  branch?: string;
  sha?: string;
};

export type SubmoduleBranchInfo = {
  submodule: SubmoduleInfo;
  branchName: string;
  created: boolean;
  pushed: boolean;
  error?: string;
  pushError?: string;
};

/**
 * Check if the repository has git submodules
 */
export async function hasSubmodules(repoDir: string = process.cwd()): Promise<boolean> {
  const gitmodulesPath = join(repoDir, ".gitmodules");
  return existsSync(gitmodulesPath);
}

/**
 * Parse .gitmodules file to get submodule information
 */
export async function parseGitmodules(repoDir: string = process.cwd()): Promise<SubmoduleInfo[]> {
  const gitmodulesPath = join(repoDir, ".gitmodules");
  
  if (!existsSync(gitmodulesPath)) {
    return [];
  }

  try {
    const content = await readFile(gitmodulesPath, "utf-8");
    const submodules: SubmoduleInfo[] = [];
    const sections = content.split(/\[submodule\s+"([^"]+)"\]/);
    
    for (let i = 1; i < sections.length; i += 2) {
      const name = sections[i];
      const configSection = sections[i + 1];
      
      const pathMatch = configSection.match(/^\s*path\s*=\s*(.+)$/m);
      const urlMatch = configSection.match(/^\s*url\s*=\s*(.+)$/m);
      const branchMatch = configSection.match(/^\s*branch\s*=\s*(.+)$/m);
      
      if (pathMatch && urlMatch) {
        submodules.push({
          name: name.trim(),
          path: pathMatch[1].trim(),
          url: urlMatch[1].trim(),
          branch: branchMatch?.[1]?.trim(),
        });
      }
    }
    
    return submodules;
  } catch (error) {
    console.error("Error parsing .gitmodules:", error);
    return [];
  }
}

/**
 * Get current submodule status including SHA information
 */
export async function getSubmoduleStatus(repoDir: string = process.cwd()): Promise<SubmoduleInfo[]> {
  try {
    const result = await $`git submodule status`.cwd(repoDir).text();
    const statusLines = result.trim().split("\n").filter(line => line.trim());
    
    const submodules = await parseGitmodules(repoDir);
    const statusMap = new Map<string, string>();
    
    for (const line of statusLines) {
      // Parse git submodule status output: " sha path (branch)" or "-sha path" or "+sha path"
      const match = line.trim().match(/^[+-\s]([a-f0-9]+)\s+(.+?)(?:\s+\((.+)\))?$/);
      if (match) {
        const [, sha, path] = match;
        statusMap.set(path, sha);
      }
    }
    
    // Merge status info with .gitmodules info
    return submodules.map(submodule => ({
      ...submodule,
      sha: statusMap.get(submodule.path),
    }));
  } catch (error) {
    console.error("Error getting submodule status:", error);
    return await parseGitmodules(repoDir);
  }
}

/**
 * Initialize and update submodules
 */
export async function initializeSubmodules(repoDir: string = process.cwd()): Promise<void> {
  try {
    console.log("Initializing and updating submodules...");
    
    // First check if we have any submodules
    if (!await hasSubmodules(repoDir)) {
      console.log("No submodules found, skipping initialization");
      return;
    }
    
    // Initialize submodules step by step for better error reporting
    console.log("Running: git submodule init");
    await $`git submodule init`.cwd(repoDir);
    
    console.log("Running: git submodule update --recursive");
    await $`git submodule update --recursive`.cwd(repoDir);
    
    console.log("✓ Submodules initialized and updated successfully");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("❌ Error initializing submodules:", errorMessage);
    
    // Try to provide more helpful error information
    try {
      const submodules = await parseGitmodules(repoDir);
      if (submodules.length > 0) {
        console.error(`Found ${submodules.length} submodules in .gitmodules:`);
        submodules.forEach(sub => {
          console.error(`  - ${sub.name}: ${sub.url} (path: ${sub.path})`);
        });
      }
    } catch {
      // Ignore errors when trying to provide additional info
    }
    
    throw error;
  }
}

/**
 * Create a branch in a submodule
 */
export async function createSubmoduleBranch(
  submodule: SubmoduleInfo,
  branchName: string,
  baseBranch?: string,
  pushStrategy: "immediate" | "deferred" = "immediate",
  repoDir: string = process.cwd()
): Promise<SubmoduleBranchInfo> {
  const submodulePath = join(repoDir, submodule.path);
  
  try {
    console.log(`🔧 Creating branch ${branchName} in submodule ${submodule.name}...`);
    
    // Ensure we're in the submodule directory
    if (!existsSync(submodulePath)) {
      const errorMsg = `Submodule path does not exist: ${submodulePath}`;
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // Check if this is actually a git repository
    const gitDir = join(submodulePath, '.git');
    if (!existsSync(gitDir)) {
      const errorMsg = `Submodule ${submodule.name} is not properly initialized (no .git directory found)`;
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // Check if branch already exists
    try {
      await $`git rev-parse --verify ${branchName}`.cwd(submodulePath);
      console.log(`⚠️ Branch ${branchName} already exists in submodule ${submodule.name}, checking out...`);
      await $`git checkout ${branchName}`.cwd(submodulePath);
      console.log(`✓ Checked out existing branch ${branchName} in submodule ${submodule.name}`);
      
      // Handle push based on strategy
      let pushed = false;
      let pushError: string | undefined;
      
      if (pushStrategy === "immediate") {
        try {
          console.log(`📤 Pushing existing branch ${branchName} to remote...`);
          await $`git push origin ${branchName}`.cwd(submodulePath);
          pushed = true;
          console.log(`✓ Successfully pushed existing branch ${branchName} to remote`);
        } catch (error) {
          // Branch might already exist on remote, check if it's up to date
          try {
            await $`git push origin ${branchName} --set-upstream`.cwd(submodulePath);
            pushed = true;
            console.log(`✓ Set upstream and pushed branch ${branchName}`);
          } catch (upstreamError) {
            pushError = upstreamError instanceof Error ? upstreamError.message : String(upstreamError);
            console.warn(`⚠️ Could not push existing branch ${branchName}:`, pushError);
          }
        }
      } else {
        console.log(`📋 Deferred push strategy: branch ${branchName} will be pushed on first commit`);
      }
      
      return {
        submodule,
        branchName,
        created: false,
        pushed,
        pushError,
      };
    } catch {
      // Branch doesn't exist, we'll create it
      console.log(`📝 Branch ${branchName} does not exist in submodule ${submodule.name}, creating...`);
    }
    
    // Determine the base branch
    const sourceBaseBranch = baseBranch || submodule.branch || "main";
    
    try {
      // Fetch latest changes
      console.log(`🔄 Fetching latest changes for submodule ${submodule.name}...`);
      await $`git fetch origin`.cwd(submodulePath);
      
      // Try to checkout the base branch first
      console.log(`🔀 Attempting to checkout base branch: ${sourceBaseBranch}`);
      try {
        await $`git checkout ${sourceBaseBranch}`.cwd(submodulePath);
        console.log(`✓ Checked out base branch ${sourceBaseBranch}`);
      } catch {
        // If base branch doesn't exist locally, try to create it from origin
        console.log(`⚠️ Base branch ${sourceBaseBranch} not found locally, trying origin...`);
        try {
          await $`git checkout -b ${sourceBaseBranch} origin/${sourceBaseBranch}`.cwd(submodulePath);
          console.log(`✓ Created and checked out ${sourceBaseBranch} from origin`);
        } catch {
          // Fall back to default branch
          console.warn(`⚠️ Base branch ${sourceBaseBranch} not found on origin, using current HEAD`);
        }
      }
      
      // Create and checkout the new branch
      console.log(`🆕 Creating new branch ${branchName}...`);
      await $`git checkout -b ${branchName}`.cwd(submodulePath);
      
      console.log(`✅ Successfully created branch ${branchName} in submodule ${submodule.name}`);
      
      // Handle push based on strategy
      let pushed = false;
      let pushError: string | undefined;
      
      if (pushStrategy === "immediate") {
        try {
          console.log(`📤 Pushing new branch ${branchName} to remote...`);
          await $`git push origin ${branchName} --set-upstream`.cwd(submodulePath);
          pushed = true;
          console.log(`✅ Successfully pushed new branch ${branchName} to remote`);
        } catch (error) {
          pushError = error instanceof Error ? error.message : String(error);
          console.error(`❌ Failed to push new branch ${branchName}:`, pushError);
          
          // Try to get more information about the push failure
          try {
            const remoteStatus = await $`git status -sb`.cwd(submodulePath).text();
            console.error(`Git status for ${submodule.name}:`, remoteStatus);
          } catch {
            // Ignore status check errors
          }
        }
      } else {
        console.log(`📋 Deferred push strategy: new branch ${branchName} will be pushed on first commit`);
      }
      
      return {
        submodule,
        branchName,
        created: true,
        pushed,
        pushError,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Error creating branch in submodule ${submodule.name}:`, errorMessage);
      
      // Try to get more diagnostic information
      try {
        const remoteInfo = await $`git remote -v`.cwd(submodulePath).text();
        console.error(`Remote info for ${submodule.name}:`, remoteInfo);
      } catch {
        console.error(`Could not get remote info for ${submodule.name}`);
      }
      
      return {
        submodule,
        branchName,
        created: false,
        pushed: false,
        error: errorMessage,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error processing submodule ${submodule.name}:`, errorMessage);
    
    return {
      submodule,
      branchName,
      created: false,
      pushed: false,
      error: errorMessage,
    };
  }
}

/**
 * Create branches in all submodules
 */
export async function setupSubmoduleBranches(
  branchName: string,
  baseBranch?: string,
  pushStrategy: "immediate" | "deferred" = "immediate",
  repoDir: string = process.cwd()
): Promise<SubmoduleBranchInfo[]> {
  try {
    console.log(`🔍 Checking for submodules in repository...`);
    
    // Check if we have submodules
    if (!await hasSubmodules(repoDir)) {
      console.log("✅ No submodules detected, skipping submodule branch setup");
      return [];
    }
    
    console.log("📦 Submodules detected, initializing...");
    
    // Initialize submodules
    await initializeSubmodules(repoDir);
    
    // Get submodule information
    const submodules = await getSubmoduleStatus(repoDir);
    
    if (submodules.length === 0) {
      console.log("⚠️ No submodules found in .gitmodules after initialization");
      return [];
    }
    
    console.log(`📋 Found ${submodules.length} submodules, creating branches with ${pushStrategy} push strategy...`);
    submodules.forEach(sub => {
      console.log(`  - ${sub.name}: ${sub.url} (path: ${sub.path})`);
    });
    
    // Create branches in parallel for better performance
    const branchResults = await Promise.all(
      submodules.map(submodule => 
        createSubmoduleBranch(submodule, branchName, baseBranch, pushStrategy, repoDir)
      )
    );
    
    // Log results
    const successful = branchResults.filter(result => !result.error);
    const failed = branchResults.filter(result => result.error);
    
    console.log(`✅ Successfully processed ${successful.length}/${submodules.length} submodules`);
    if (successful.length > 0) {
      console.log("✓ Successful submodules:");
      successful.forEach(result => {
        const status = result.created ? '🆕 created' : '♻️ already exists';
        console.log(`  - ${result.submodule.name}: ${status} branch '${result.branchName}'`);
      });
    }
    
    if (failed.length > 0) {
      console.warn(`❌ Failed to process ${failed.length} submodules:`);
      failed.forEach(result => {
        console.warn(`  - ${result.submodule.name}: ${result.error}`);
      });
    }
    
    return branchResults;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("❌ Error setting up submodule branches:", errorMessage);
    throw error;
  }
}

/**
 * Get the remote URL for a submodule to determine if it's accessible
 */
export async function getSubmoduleRemoteInfo(
  submodule: SubmoduleInfo,
  repoDir: string = process.cwd()
): Promise<{ accessible: boolean; remoteUrl?: string }> {
  const submodulePath = join(repoDir, submodule.path);
  
  try {
    const remoteUrl = await $`git remote get-url origin`.cwd(submodulePath).text();
    return {
      accessible: true,
      remoteUrl: remoteUrl.trim(),
    };
  } catch {
    return {
      accessible: false,
    };
  }
}

/**
 * Check if we have write access to submodule repositories
 */
export async function validateSubmoduleAccess(
  octokits: Octokits,
  submodules: SubmoduleInfo[]
): Promise<Map<string, boolean>> {
  const accessMap = new Map<string, boolean>();
  
  for (const submodule of submodules) {
    try {
      // Parse GitHub URL to get owner/repo
      const urlMatch = submodule.url.match(/github\.com[/:]([\w-]+)\/([\w-]+)/);
      if (!urlMatch) {
        accessMap.set(submodule.name, false);
        continue;
      }
      
      const [, owner, repoName] = urlMatch;
      const repo = repoName.replace(/\.git$/, "");
      
      // Check if we have push access
      const response = await octokits.rest.repos.get({
        owner,
        repo,
      });
      
      // If we can read the repo and it's not a fork, assume we have access
      // In a real implementation, you might want to check permissions more thoroughly
      accessMap.set(submodule.name, response.data.permissions?.push ?? false);
    } catch {
      accessMap.set(submodule.name, false);
    }
  }
  
  return accessMap;
}