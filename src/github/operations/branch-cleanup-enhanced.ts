#!/usr/bin/env bun

/**
 * Enhanced branch cleanup utilities
 * Handles cleanup of empty or failed branches for both main repository and submodules
 */

import { $ } from "bun";
import { join } from "path";
import { existsSync } from "fs";
import type { SubmoduleBranchInfo } from "./submodule";
import type { Octokits } from "../api/client";

export type CleanupOptions = {
  removeEmptyBranches?: boolean;
  removeFailedBranches?: boolean;
  dryRun?: boolean;
  timeout?: number;
  repoDir?: string;
};

export type CleanupResult = {
  mainRepository?: {
    branchName: string;
    cleaned: boolean;
    reason?: string;
    error?: string;
  };
  submodules: Array<{
    name: string;
    branchName: string;
    cleaned: boolean;
    reason?: string;
    error?: string;
  }>;
  summary: {
    total: number;
    cleaned: number;
    failed: number;
  };
};

/**
 * Check if a branch has any commits
 */
async function hasCommits(branchName: string, repoPath: string): Promise<boolean> {
  try {
    await $`git rev-list --count ${branchName}`.cwd(repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a branch has any changes compared to base branch
 */
async function hasChanges(branchName: string, baseBranch: string, repoPath: string): Promise<boolean> {
  try {
    const result = await $`git rev-list --count ${baseBranch}..${branchName}`.cwd(repoPath).text();
    return parseInt(result.trim()) > 0;
  } catch {
    return false;
  }
}

/**
 * Check if a branch exists locally
 */
async function branchExistsLocally(branchName: string, repoPath: string): Promise<boolean> {
  try {
    await $`git rev-parse --verify ${branchName}`.cwd(repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a branch exists on remote
 */
async function branchExistsOnRemote(branchName: string, repoPath: string): Promise<boolean> {
  try {
    await $`git ls-remote --heads origin ${branchName}`.cwd(repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up a single branch (local and remote)
 */
async function cleanupSingleBranch(
  branchName: string,
  baseBranch: string,
  repoPath: string,
  options: CleanupOptions,
  repoName: string = "repository"
): Promise<{ cleaned: boolean; reason?: string; error?: string }> {
  const { removeEmptyBranches = true, removeFailedBranches = true, dryRun = false } = options;
  
  try {
    console.log(`🔍 Analyzing branch ${branchName} in ${repoName}...`);
    
    const localExists = await branchExistsLocally(branchName, repoPath);
    const remoteExists = await branchExistsOnRemote(branchName, repoPath);
    
    if (!localExists && !remoteExists) {
      return { cleaned: false, reason: "Branch does not exist" };
    }
    
    // Check if branch has commits
    const hasLocalCommits = localExists ? await hasCommits(branchName, repoPath) : false;
    const hasChangesFromBase = localExists ? await hasChanges(branchName, baseBranch, repoPath) : false;
    
    // Determine if branch should be cleaned up
    let shouldClean = false;
    let reason = "";
    
    if (!hasLocalCommits && removeEmptyBranches) {
      shouldClean = true;
      reason = "Branch has no commits";
    } else if (!hasChangesFromBase && removeEmptyBranches) {
      shouldClean = true;
      reason = "Branch has no changes from base branch";
    } else if (removeFailedBranches) {
      // Additional logic for failed branches could be added here
      // For now, we consider branches that exist but have no meaningful changes
      if (localExists && !hasChangesFromBase) {
        shouldClean = true;
        reason = "Branch appears to be failed/unused";
      }
    }
    
    if (!shouldClean) {
      console.log(`✓ Branch ${branchName} in ${repoName} is active and will be kept`);
      return { cleaned: false, reason: "Branch is active" };
    }
    
    if (dryRun) {
      console.log(`[DRY RUN] Would clean up branch ${branchName} in ${repoName}: ${reason}`);
      return { cleaned: true, reason: `[DRY RUN] ${reason}` };
    }
    
    console.log(`🧹 Cleaning up branch ${branchName} in ${repoName}: ${reason}`);
    
    // Switch to base branch before cleanup
    if (localExists) {
      const currentBranch = await $`git branch --show-current`.cwd(repoPath).text();
      if (currentBranch.trim() === branchName) {
        console.log(`🔀 Switching from ${branchName} to ${baseBranch}...`);
        await $`git checkout ${baseBranch}`.cwd(repoPath);
      }
      
      // Delete local branch
      console.log(`🗑️ Deleting local branch ${branchName}...`);
      await $`git branch -D ${branchName}`.cwd(repoPath);
    }
    
    // Delete remote branch if it exists
    if (remoteExists) {
      console.log(`🗑️ Deleting remote branch ${branchName}...`);
      await $`git push origin --delete ${branchName}`.cwd(repoPath);
    }
    
    console.log(`✅ Successfully cleaned up branch ${branchName} in ${repoName}`);
    return { cleaned: true, reason };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to clean up branch ${branchName} in ${repoName}:`, errorMessage);
    return { cleaned: false, error: errorMessage };
  }
}

/**
 * Clean up main repository and submodule branches
 */
export async function cleanupBranches(
  mainBranchName: string | undefined,
  baseBranch: string,
  submoduleBranches: SubmoduleBranchInfo[],
  options: CleanupOptions = {}
): Promise<CleanupResult> {
  const { repoDir = process.cwd() } = options;
  const result: CleanupResult = {
    submodules: [],
    summary: {
      total: 0,
      cleaned: 0,
      failed: 0,
    },
  };
  
  console.log("🧹 Starting enhanced branch cleanup...");
  
  // Clean up main repository branch
  if (mainBranchName) {
    result.summary.total++;
    
    const mainResult = await cleanupSingleBranch(
      mainBranchName,
      baseBranch,
      repoDir,
      options,
      "main repository"
    );
    
    result.mainRepository = {
      branchName: mainBranchName,
      cleaned: mainResult.cleaned,
      reason: mainResult.reason,
      error: mainResult.error,
    };
    
    if (mainResult.cleaned) {
      result.summary.cleaned++;
    } else if (mainResult.error) {
      result.summary.failed++;
    }
  }
  
  // Clean up submodule branches
  for (const submoduleBranch of submoduleBranches) {
    result.summary.total++;
    
    const submodulePath = join(repoDir, submoduleBranch.submodule.path);
    
    if (!existsSync(submodulePath)) {
      result.submodules.push({
        name: submoduleBranch.submodule.name,
        branchName: submoduleBranch.branchName,
        cleaned: false,
        error: "Submodule path does not exist",
      });
      result.summary.failed++;
      continue;
    }
    
    // Skip cleanup if submodule branch creation failed
    if (submoduleBranch.error) {
      console.log(`⏭️ Skipping cleanup for failed submodule ${submoduleBranch.submodule.name}`);
      result.submodules.push({
        name: submoduleBranch.submodule.name,
        branchName: submoduleBranch.branchName,
        cleaned: false,
        reason: "Branch creation failed originally",
      });
      continue;
    }
    
    const submoduleResult = await cleanupSingleBranch(
      submoduleBranch.branchName,
      baseBranch,
      submodulePath,
      options,
      `submodule ${submoduleBranch.submodule.name}`
    );
    
    result.submodules.push({
      name: submoduleBranch.submodule.name,
      branchName: submoduleBranch.branchName,
      cleaned: submoduleResult.cleaned,
      reason: submoduleResult.reason,
      error: submoduleResult.error,
    });
    
    if (submoduleResult.cleaned) {
      result.summary.cleaned++;
    } else if (submoduleResult.error) {
      result.summary.failed++;
    }
  }
  
  // Print summary
  console.log(`\n📊 Cleanup Summary:`);
  console.log(`   Total branches processed: ${result.summary.total}`);
  console.log(`   Branches cleaned: ${result.summary.cleaned}`);
  console.log(`   Cleanup failures: ${result.summary.failed}`);
  console.log(`   Branches kept: ${result.summary.total - result.summary.cleaned - result.summary.failed}`);
  
  if (options.dryRun) {
    console.log(`\n🔍 This was a dry run - no actual changes were made`);
  }
  
  return result;
}

/**
 * Clean up branches that were marked as failed during creation
 */
export async function cleanupFailedBranches(
  submoduleBranches: SubmoduleBranchInfo[],
  options: CleanupOptions = {}
): Promise<CleanupResult> {
  const failedBranches = submoduleBranches.filter(branch => branch.error);
  
  if (failedBranches.length === 0) {
    console.log("✓ No failed branches to clean up");
    return {
      submodules: [],
      summary: { total: 0, cleaned: 0, failed: 0 },
    };
  }
  
  console.log(`🧹 Cleaning up ${failedBranches.length} failed branches...`);
  
  return cleanupBranches(
    undefined, // No main branch to clean
    options.repoDir ? "main" : "main", // Base branch
    failedBranches,
    { ...options, removeFailedBranches: true }
  );
}

/**
 * Schedule automatic cleanup after a delay (useful for CI/CD scenarios)
 */
export async function scheduleCleanup(
  mainBranchName: string | undefined,
  baseBranch: string,
  submoduleBranches: SubmoduleBranchInfo[],
  delayMs: number,
  options: CleanupOptions = {}
): Promise<void> {
  console.log(`⏰ Scheduling branch cleanup in ${delayMs / 1000} seconds...`);
  
  setTimeout(async () => {
    try {
      console.log("🧹 Starting scheduled branch cleanup...");
      await cleanupBranches(mainBranchName, baseBranch, submoduleBranches, options);
    } catch (error) {
      console.error("❌ Scheduled cleanup failed:", error);
    }
  }, delayMs);
}