#!/usr/bin/env bun

/**
 * Setup the appropriate branch based on the event type:
 * - For PRs: Checkout the PR branch
 * - For Issues: Create a new branch
 */

import { $ } from "bun";
import * as core from "@actions/core";
import type { ParsedGitHubContext } from "../context";
import type { GitHubPullRequest } from "../types";
import type { Octokits } from "../api/client";
import type { FetchDataResult } from "../data/fetcher";
import { setupSubmoduleBranches, type SubmoduleBranchInfo } from "./submodule";

export type BranchInfo = {
  baseBranch: string;
  claudeBranch?: string;
  currentBranch: string;
  submoduleBranches?: SubmoduleBranchInfo[];
  pushStrategy?: "immediate" | "deferred" | "auto";
};

/**
 * Determine the effective push strategy based on user setting and context
 */
function determinePushStrategy(
  userStrategy: "immediate" | "deferred" | "auto",
  useCommitSigning: boolean
): "immediate" | "deferred" {
  switch (userStrategy) {
    case "immediate":
      if (useCommitSigning) {
        console.warn("⚠️ Immediate push strategy not compatible with commit signing, using deferred strategy");
        return "deferred";
      }
      return "immediate";
    case "deferred":
      return "deferred";
    case "auto":
      // Auto mode: use deferred if commit signing is enabled, otherwise immediate
      return useCommitSigning ? "deferred" : "immediate";
  }
}

/**
 * Push branch to remote repository
 */
async function pushBranchToRemote(branchName: string): Promise<void> {
  try {
    console.log(`📤 Pushing branch ${branchName} to remote...`);
    await $`git push origin ${branchName} --set-upstream`;
    console.log(`✅ Successfully pushed branch ${branchName} to remote`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to push branch ${branchName}:`, errorMessage);
    throw error;
  }
}

export async function setupBranch(
  octokits: Octokits,
  githubData: FetchDataResult,
  context: ParsedGitHubContext,
): Promise<BranchInfo> {
  const { owner, repo } = context.repository;
  const entityNumber = context.entityNumber;
  const { baseBranch, branchPrefix, useCommitSigning, enableSubmoduleBranches, branchPushStrategy } = context.inputs;
  const isPR = context.isPR;
  
  // Determine the effective push strategy
  const effectivePushStrategy = determinePushStrategy(branchPushStrategy, useCommitSigning);
  console.log(`🔧 Using ${effectivePushStrategy} push strategy (user setting: ${branchPushStrategy}, commit signing: ${useCommitSigning})`);

  if (isPR) {
    const prData = githubData.contextData as GitHubPullRequest;
    const prState = prData.state;

    // Check if PR is closed or merged
    if (prState === "CLOSED" || prState === "MERGED") {
      console.log(
        `PR #${entityNumber} is ${prState}, creating new branch from source...`,
      );
      // Fall through to create a new branch like we do for issues
    } else {
      // Handle open PR: Checkout the PR branch
      console.log("This is an open PR, checking out PR branch...");

      const branchName = prData.headRefName;

      // Determine optimal fetch depth based on PR commit count, with a minimum of 20
      const commitCount = prData.commits.totalCount;
      const fetchDepth = Math.max(commitCount, 20);

      console.log(
        `PR #${entityNumber}: ${commitCount} commits, using fetch depth ${fetchDepth}`,
      );

      // Execute git commands to checkout PR branch (dynamic depth based on PR size)
      await $`git fetch origin --depth=${fetchDepth} ${branchName}`;
      await $`git checkout ${branchName} --`;

      console.log(`Successfully checked out PR branch for PR #${entityNumber}`);

      // For open PRs, we need to get the base branch of the PR
      const baseBranch = prData.baseRefName;

      return {
        baseBranch,
        currentBranch: branchName,
      };
    }
  }

  // Determine source branch - use baseBranch if provided, otherwise fetch default
  let sourceBranch: string;

  if (baseBranch) {
    // Use provided base branch for source
    sourceBranch = baseBranch;
  } else {
    // No base branch provided, fetch the default branch to use as source
    const repoResponse = await octokits.rest.repos.get({
      owner,
      repo,
    });
    sourceBranch = repoResponse.data.default_branch;
  }

  // Generate branch name for either an issue or closed/merged PR
  const entityType = isPR ? "pr" : "issue";

  // Create Kubernetes-compatible timestamp: lowercase, hyphens only, shorter format
  const now = new Date();
  const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

  // Ensure branch name is Kubernetes-compatible:
  // - Lowercase only
  // - Alphanumeric with hyphens
  // - No underscores
  // - Max 50 chars (to allow for prefixes)
  const branchName = `${branchPrefix}${entityType}-${entityNumber}-${timestamp}`;
  const newBranch = branchName.toLowerCase().substring(0, 50);

  try {
    // Get the SHA of the source branch to verify it exists
    const sourceBranchRef = await octokits.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${sourceBranch}`,
    });

    const currentSHA = sourceBranchRef.data.object.sha;
    console.log(`Source branch SHA: ${currentSHA}`);

    // Handle branch creation based on push strategy
    if (effectivePushStrategy === "deferred") {
      console.log(
        `Branch name generated: ${newBranch} (will be ${useCommitSigning ? 'created by file ops server on first commit' : 'pushed on first commit'})`,
      );

      // Ensure we're on the source branch
      console.log(`Fetching and checking out source branch: ${sourceBranch}`);
      await $`git fetch origin ${sourceBranch} --depth=1`;
      await $`git checkout ${sourceBranch}`;
      
      // For deferred push without commit signing, create the branch locally
      if (!useCommitSigning) {
        await $`git checkout -b ${newBranch}`;
        console.log(`✅ Created local branch ${newBranch} (push deferred until first commit)`);
      }

      // Set outputs for GitHub Actions
      core.setOutput("CLAUDE_BRANCH", newBranch);
      core.setOutput("BASE_BRANCH", sourceBranch);

      // Setup submodule branches if enabled
      let submoduleBranches: SubmoduleBranchInfo[] = [];
      if (enableSubmoduleBranches !== false) {
        try {
          console.log("Setting up submodule branches...");
          submoduleBranches = await setupSubmoduleBranches(newBranch, sourceBranch, effectivePushStrategy);
          if (submoduleBranches.length > 0) {
            console.log(`✓ Set up branches in ${submoduleBranches.length} submodules`);
          }
        } catch (error) {
          console.warn("Failed to setup submodule branches:", error);
          // Don't fail the entire process for submodule errors
        }
      }

      return {
        baseBranch: sourceBranch,
        claudeBranch: newBranch,
        currentBranch: useCommitSigning ? sourceBranch : newBranch,
        submoduleBranches,
        pushStrategy: effectivePushStrategy,
      };
    }

    // Immediate push strategy: create branch and push immediately
    console.log(
      `Creating and pushing branch ${newBranch} for ${entityType} #${entityNumber} from source branch: ${sourceBranch}...`,
    );

    // Fetch and checkout the source branch first to ensure we branch from the correct base
    console.log(`Fetching and checking out source branch: ${sourceBranch}`);
    await $`git fetch origin ${sourceBranch} --depth=1`;
    await $`git checkout ${sourceBranch}`;

    // Create and checkout the new branch from the source branch
    await $`git checkout -b ${newBranch}`;

    console.log(`✅ Successfully created local branch: ${newBranch}`);

    // Push the branch immediately
    try {
      await pushBranchToRemote(newBranch);
    } catch (error) {
      console.warn(`⚠️ Failed to push main repository branch ${newBranch}, continuing with local branch only`);
      // Continue execution even if push fails
    }

    // Set outputs for GitHub Actions
    core.setOutput("CLAUDE_BRANCH", newBranch);
    core.setOutput("BASE_BRANCH", sourceBranch);

    // Setup submodule branches if enabled
    let submoduleBranches: SubmoduleBranchInfo[] = [];
    if (enableSubmoduleBranches !== false) {
      try {
        console.log("Setting up submodule branches...");
        submoduleBranches = await setupSubmoduleBranches(newBranch, sourceBranch, effectivePushStrategy);
        if (submoduleBranches.length > 0) {
          console.log(`✓ Set up branches in ${submoduleBranches.length} submodules`);
        }
      } catch (error) {
        console.warn("Failed to setup submodule branches:", error);
        // Don't fail the entire process for submodule errors
      }
    }

    return {
      baseBranch: sourceBranch,
      claudeBranch: newBranch,
      currentBranch: newBranch,
      submoduleBranches,
      pushStrategy: effectivePushStrategy,
    };
  } catch (error) {
    console.error("Error in branch setup:", error);
    process.exit(1);
  }
}
