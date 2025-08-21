#!/usr/bin/env bun

/**
 * Git submodule operations for handling submodule branches and commits
 */

import { $ } from "bun";
import * as core from "@actions/core";
import { readFile } from "fs/promises";
import { join } from "path";
import type { Octokits } from "../api/client";

export type SubmoduleInfo = {
  path: string;
  url: string;
  branch?: string;
};

export type SubmoduleBranchInfo = {
  path: string;
  originalBranch: string;
  newBranch: string;
  hasChanges: boolean;
};

/**
 * Parse .gitmodules file to get submodule information
 */
export async function getSubmodules(): Promise<SubmoduleInfo[]> {
  try {
    const gitmodulesPath = join(process.cwd(), ".gitmodules");
    const content = await readFile(gitmodulesPath, "utf-8");
    
    const submodules: SubmoduleInfo[] = [];
    const sections = content.split(/\[submodule\s+"([^"]+)"\]/);
    
    for (let i = 1; i < sections.length; i += 2) {
      const name = sections[i];
      const config = sections[i + 1];
      
      const pathMatch = config.match(/path\s*=\s*(.+)/);
      const urlMatch = config.match(/url\s*=\s*(.+)/);
      const branchMatch = config.match(/branch\s*=\s*(.+)/);
      
      if (pathMatch && urlMatch) {
        submodules.push({
          path: pathMatch[1].trim(),
          url: urlMatch[1].trim(),
          branch: branchMatch?.[1]?.trim(),
        });
      }
    }
    
    return submodules;
  } catch (error) {
    // No .gitmodules file or error reading it
    console.log("No .gitmodules file found or error reading it:", error);
    return [];
  }
}

/**
 * Initialize and update all submodules
 */
export async function initializeSubmodules(): Promise<void> {
  try {
    console.log("Initializing and updating submodules...");
    await $`git submodule update --init --recursive`;
    console.log("✓ Submodules initialized and updated");
  } catch (error) {
    console.log("No submodules to initialize or error:", error);
  }
}

/**
 * Check out existing branches in submodules or create new ones if they don't exist
 */
export async function checkoutOrCreateSubmoduleBranches(
  branchName: string,
  submodules: SubmoduleInfo[],
  existingBranch: string,
): Promise<SubmoduleBranchInfo[]> {
  const branchInfos: SubmoduleBranchInfo[] = [];
  
  for (const submodule of submodules) {
    try {
      console.log(`Checking for existing branch ${branchName} in submodule ${submodule.path}...`);
      
      // Get current branch name
      const currentBranchResult = await $`cd ${submodule.path} && git rev-parse --abbrev-ref HEAD`.text();
      const currentBranch = currentBranchResult.trim();
      
      // Try to fetch and checkout the existing branch
      try {
        await $`cd ${submodule.path} && git fetch origin ${branchName}`;
        await $`cd ${submodule.path} && git checkout ${branchName}`;
        console.log(`✓ Checked out existing branch ${branchName} in submodule ${submodule.path}`);
      } catch (fetchError) {
        // Branch doesn't exist in submodule, create it
        console.log(`Branch ${branchName} doesn't exist in submodule ${submodule.path}, creating new branch...`);
        await $`cd ${submodule.path} && git checkout -b ${branchName}`;
        console.log(`✓ Created new branch ${branchName} in submodule ${submodule.path}`);
      }
      
      branchInfos.push({
        path: submodule.path,
        originalBranch: currentBranch,
        newBranch: branchName,
        hasChanges: false,
      });
      
    } catch (error) {
      console.error(`Failed to checkout/create branch in submodule ${submodule.path}:`, error);
      // Continue with other submodules
    }
  }
  
  return branchInfos;
}

/**
 * Create matching branches in all submodules
 */
export async function createSubmoduleBranches(
  branchName: string,
  submodules: SubmoduleInfo[],
): Promise<SubmoduleBranchInfo[]> {
  const branchInfos: SubmoduleBranchInfo[] = [];
  
  for (const submodule of submodules) {
    try {
      console.log(`Creating branch ${branchName} in submodule ${submodule.path}...`);
      
      // Get current branch name
      const currentBranchResult = await $`cd ${submodule.path} && git rev-parse --abbrev-ref HEAD`.text();
      const currentBranch = currentBranchResult.trim();
      
      // Create and checkout new branch
      await $`cd ${submodule.path} && git checkout -b ${branchName}`;
      
      branchInfos.push({
        path: submodule.path,
        originalBranch: currentBranch,
        newBranch: branchName,
        hasChanges: false,
      });
      
      console.log(`✓ Created branch ${branchName} in submodule ${submodule.path}`);
    } catch (error) {
      console.error(`Failed to create branch in submodule ${submodule.path}:`, error);
      // Continue with other submodules
    }
  }
  
  return branchInfos;
}

/**
 * Check if a file path is within a submodule
 */
export function getSubmoduleForPath(filePath: string, submodules: SubmoduleInfo[]): SubmoduleInfo | null {
  // Normalize the file path
  const normalizedPath = filePath.replace(/^\/+/, "");
  
  for (const submodule of submodules) {
    if (normalizedPath.startsWith(submodule.path + "/") || normalizedPath === submodule.path) {
      return submodule;
    }
  }
  
  return null;
}

/**
 * Check if submodule has uncommitted changes
 */
export async function hasSubmoduleChanges(submodulePath: string): Promise<boolean> {
  try {
    const statusResult = await $`cd ${submodulePath} && git status --porcelain`.text();
    return statusResult.trim().length > 0;
  } catch (error) {
    console.error(`Error checking submodule changes in ${submodulePath}:`, error);
    return false;
  }
}

/**
 * Commit and push changes in a submodule
 */
export async function commitSubmoduleChanges(
  submodulePath: string,
  commitMessage: string,
  branchName: string,
  coAuthorLine?: string,
): Promise<string | null> {
  try {
    console.log(`Committing changes in submodule ${submodulePath}...`);
    
    // Add all changes
    await $`cd ${submodulePath} && git add .`;
    
    // Commit with co-author if provided
    const fullCommitMessage = coAuthorLine 
      ? `${commitMessage}\n\n${coAuthorLine}`
      : commitMessage;
    
    await $`cd ${submodulePath} && git commit -m ${fullCommitMessage}`;
    
    // Get the commit SHA
    const commitShaResult = await $`cd ${submodulePath} && git rev-parse HEAD`.text();
    const commitSha = commitShaResult.trim();
    
    // Push the branch
    await $`cd ${submodulePath} && git push origin ${branchName}`;
    
    console.log(`✓ Committed and pushed changes in submodule ${submodulePath}`);
    return commitSha;
  } catch (error) {
    console.error(`Failed to commit/push submodule changes in ${submodulePath}:`, error);
    return null;
  }
}

/**
 * Update parent repository's submodule reference
 */
export async function updateSubmoduleReference(
  submodulePath: string,
  commitMessage: string,
  coAuthorLine?: string,
): Promise<void> {
  try {
    console.log(`Updating submodule reference for ${submodulePath}...`);
    
    // Add the submodule path to stage the reference update
    await $`git add ${submodulePath}`;
    
    // Commit the submodule reference update
    const fullCommitMessage = coAuthorLine 
      ? `${commitMessage}\n\n${coAuthorLine}`
      : commitMessage;
    
    await $`git commit -m ${fullCommitMessage}`;
    
    console.log(`✓ Updated submodule reference for ${submodulePath}`);
  } catch (error) {
    console.error(`Failed to update submodule reference for ${submodulePath}:`, error);
    throw error;
  }
}

/**
 * Get the remote URL for a submodule and extract owner/repo
 */
export async function getSubmoduleRemoteInfo(submodulePath: string): Promise<{ owner: string; repo: string } | null> {
  try {
    const remoteUrlResult = await $`cd ${submodulePath} && git remote get-url origin`.text();
    const remoteUrl = remoteUrlResult.trim();
    
    // Parse GitHub URL to extract owner/repo
    const githubMatch = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (githubMatch) {
      return {
        owner: githubMatch[1],
        repo: githubMatch[2],
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Failed to get remote info for submodule ${submodulePath}:`, error);
    return null;
  }
}

/**
 * Clean up submodule branches (used during branch cleanup)
 */
export async function cleanupSubmoduleBranches(
  branchName: string,
  submodules: SubmoduleInfo[],
  octokits: Octokits,
): Promise<void> {
  for (const submodule of submodules) {
    try {
      const remoteInfo = await getSubmoduleRemoteInfo(submodule.path);
      if (!remoteInfo) {
        console.log(`Skipping cleanup for submodule ${submodule.path}: could not determine remote info`);
        continue;
      }
      
      console.log(`Cleaning up branch ${branchName} in submodule ${submodule.path}...`);
      
      // Try to delete the remote branch
      try {
        await octokits.rest.git.deleteRef({
          owner: remoteInfo.owner,
          repo: remoteInfo.repo,
          ref: `heads/${branchName}`,
        });
        console.log(`✓ Deleted remote branch ${branchName} in submodule ${submodule.path}`);
      } catch (deleteError: any) {
        if (deleteError.status === 422) {
          console.log(`Branch ${branchName} doesn't exist in submodule ${submodule.path}`);
        } else {
          console.error(`Failed to delete remote branch in submodule ${submodule.path}:`, deleteError);
        }
      }
    } catch (error) {
      console.error(`Error during submodule cleanup for ${submodule.path}:`, error);
      // Continue with other submodules
    }
  }
}