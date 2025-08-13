#!/usr/bin/env bun

/**
 * Branch synchronization utilities for coordinating main repository and submodule branches
 * Handles scenarios where different push strategies might need coordination
 */

import { $ } from "bun";
import { join } from "path";
import { existsSync } from "fs";
import type { SubmoduleBranchInfo, SubmoduleInfo } from "./submodule";

export type BranchSyncOptions = {
  mainRepoPushStrategy: "immediate" | "deferred";
  submodulePushStrategy: "immediate" | "deferred";
  timeout?: number; // in milliseconds
  repoDir?: string;
};

/**
 * Check if a branch exists on the remote repository
 */
async function checkRemoteBranchExists(
  branchName: string,
  repoPath: string = process.cwd()
): Promise<boolean> {
  try {
    await $`git ls-remote --heads origin ${branchName}`.cwd(repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a remote branch to become available (useful for cross-repository dependencies)
 */
async function waitForRemoteBranch(
  branchName: string,
  repoPath: string = process.cwd(),
  timeout: number = 30000,
  pollInterval: number = 2000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (await checkRemoteBranchExists(branchName, repoPath)) {
      console.log(`✓ Remote branch ${branchName} is now available`);
      return true;
    }
    
    console.log(`⏳ Waiting for remote branch ${branchName}... (${Math.floor((Date.now() - startTime) / 1000)}s)`);
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  console.warn(`⚠️ Timeout waiting for remote branch ${branchName} (${timeout}ms)`);
  return false;
}

/**
 * Push a deferred branch to remote (for both main repo and submodules)
 */
export async function pushDeferredBranch(
  branchName: string,
  repoPath: string = process.cwd(),
  isSubmodule: boolean = false
): Promise<boolean> {
  try {
    const repoType = isSubmodule ? "submodule" : "main repository";
    console.log(`📤 Pushing deferred branch ${branchName} in ${repoType}...`);
    
    // Check if we're on the correct branch
    const currentBranch = await $`git branch --show-current`.cwd(repoPath).text();
    if (currentBranch.trim() !== branchName) {
      console.log(`🔀 Switching to branch ${branchName}...`);
      await $`git checkout ${branchName}`.cwd(repoPath);
    }
    
    // Check if there are any commits to push
    try {
      await $`git rev-parse --verify HEAD`.cwd(repoPath);
    } catch {
      console.log(`⚠️ No commits found on branch ${branchName}, creating initial empty commit...`);
      await $`git commit --allow-empty -m "Initial commit for ${branchName}"`.cwd(repoPath);
    }
    
    // Push the branch
    await $`git push origin ${branchName} --set-upstream`.cwd(repoPath);
    console.log(`✅ Successfully pushed deferred branch ${branchName} in ${repoType}`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to push deferred branch ${branchName}:`, errorMessage);
    return false;
  }
}

/**
 * Ensure submodule branches are ready before main repository operations
 * This is particularly important when main repo needs to reference submodule commits
 */
export async function ensureSubmoduleBranchesReady(
  submoduleBranches: SubmoduleBranchInfo[],
  options: BranchSyncOptions
): Promise<void> {
  const { mainRepoPushStrategy, submodulePushStrategy, timeout = 60000, repoDir = process.cwd() } = options;
  
  // If both strategies are the same, no special coordination needed
  if (mainRepoPushStrategy === submodulePushStrategy) {
    console.log(`📋 Both main repo and submodules using ${mainRepoPushStrategy} strategy, no coordination needed`);
    return;
  }
  
  // Handle case where main repo is immediate but submodules are deferred
  if (mainRepoPushStrategy === "immediate" && submodulePushStrategy === "deferred") {
    console.log("🔄 Main repo is immediate, submodules are deferred - ensuring submodule branches are pushed");
    
    const pushPromises = submoduleBranches
      .filter(branch => !branch.pushed && !branch.error)
      .map(async (branch) => {
        const submodulePath = join(repoDir, branch.submodule.path);
        if (existsSync(submodulePath)) {
          await pushDeferredBranch(branch.branchName, submodulePath, true);
        }
      });
    
    await Promise.all(pushPromises);
    return;
  }
  
  // Handle case where main repo is deferred but submodules are immediate
  if (mainRepoPushStrategy === "deferred" && submodulePushStrategy === "immediate") {
    console.log("🔄 Main repo is deferred, submodules are immediate - waiting for submodule branches");
    
    const waitPromises = submoduleBranches
      .filter(branch => !branch.error)
      .map(async (branch) => {
        const submodulePath = join(repoDir, branch.submodule.path);
        if (existsSync(submodulePath)) {
          const isReady = await waitForRemoteBranch(branch.branchName, submodulePath, timeout);
          if (!isReady) {
            console.warn(`⚠️ Submodule branch ${branch.branchName} in ${branch.submodule.name} is not ready`);
          }
        }
      });
    
    await Promise.all(waitPromises);
    return;
  }
}

/**
 * Coordinate branch operations to ensure proper sequencing
 */
export async function coordinateBranchOperations(
  mainBranchName: string,
  submoduleBranches: SubmoduleBranchInfo[],
  options: BranchSyncOptions
): Promise<void> {
  console.log(`🎯 Coordinating branch operations for ${mainBranchName}`);
  
  // First ensure submodules are ready
  await ensureSubmoduleBranchesReady(submoduleBranches, options);
  
  // If main repo is using deferred strategy, we might need to push it now
  if (options.mainRepoPushStrategy === "deferred") {
    console.log("📋 Main repository using deferred strategy - will push on first commit");
    
    // Check if we have any submodule changes that might require main repo updates
    const hasSubmoduleChanges = submoduleBranches.some(branch => 
      !branch.error && (branch.created || branch.pushed)
    );
    
    if (hasSubmoduleChanges) {
      console.log("📦 Submodule changes detected - main repository may need to update submodule references");
    }
  }
  
  console.log("✅ Branch coordination completed");
}

/**
 * Validate branch consistency across repositories
 */
export async function validateBranchConsistency(
  mainBranchName: string,
  submoduleBranches: SubmoduleBranchInfo[],
  repoDir: string = process.cwd()
): Promise<{ isConsistent: boolean; issues: string[] }> {
  const issues: string[] = [];
  
  // Check main repository branch
  try {
    const mainBranchExists = await checkRemoteBranchExists(mainBranchName, repoDir);
    if (!mainBranchExists) {
      issues.push(`Main repository branch ${mainBranchName} not found on remote`);
    }
  } catch (error) {
    issues.push(`Failed to check main repository branch: ${error}`);
  }
  
  // Check submodule branches
  for (const submoduleBranch of submoduleBranches) {
    if (submoduleBranch.error) {
      issues.push(`Submodule ${submoduleBranch.submodule.name}: ${submoduleBranch.error}`);
      continue;
    }
    
    const submodulePath = join(repoDir, submoduleBranch.submodule.path);
    if (!existsSync(submodulePath)) {
      issues.push(`Submodule path does not exist: ${submodulePath}`);
      continue;
    }
    
    try {
      const branchExists = await checkRemoteBranchExists(submoduleBranch.branchName, submodulePath);
      if (!branchExists && submoduleBranch.pushed) {
        issues.push(`Submodule ${submoduleBranch.submodule.name}: branch ${submoduleBranch.branchName} marked as pushed but not found on remote`);
      }
    } catch (error) {
      issues.push(`Failed to check submodule branch ${submoduleBranch.submodule.name}: ${error}`);
    }
  }
  
  return {
    isConsistent: issues.length === 0,
    issues,
  };
}