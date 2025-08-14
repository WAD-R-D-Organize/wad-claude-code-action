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
import { findLatestClaudeBranch, validateBranchForReuse, type BranchSearchResult } from "./branch-history";
import { detectBranchIntentFromComments, getRecommendedBranchStrategy, type BranchIntentResult } from "../utils/intent-detector";

export type BranchInfo = {
  baseBranch: string;
  claudeBranch?: string;
  currentBranch: string;
  submoduleBranches?: SubmoduleBranchInfo[];
  pushStrategy?: "immediate" | "deferred" | "auto";
  branchReused?: boolean;
  branchSource?: "new" | "reused" | "error";
  intentAnalysis?: BranchIntentResult;
  searchResult?: BranchSearchResult;
  decisionReason?: string;
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
  const { baseBranch, branchPrefix, useCommitSigning, enableSubmoduleBranches, branchPushStrategy, branchReuseStrategy } = context.inputs;
  const isPR = context.isPR;
  
  // Determine the effective push strategy
  const effectivePushStrategy = determinePushStrategy(branchPushStrategy, useCommitSigning);
  console.log(`🔧 Using ${effectivePushStrategy} push strategy (user setting: ${branchPushStrategy}, commit signing: ${useCommitSigning})`);
  console.log(`🔄 Using ${branchReuseStrategy} branch reuse strategy`);

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

  // Branch reuse logic for issues (and closed/merged PRs)
  console.log(`📋 Analyzing branch reuse options for ${isPR ? "PR" : "issue"} #${entityNumber}...`);
  
  // Check if this is a brand new issue - new issues always get new branches
  const isNewIssue = context.eventName === "issues" && context.eventAction === "opened";
  if (isNewIssue && !isPR) {
    console.log(`🆕 New issue detected (#${entityNumber}), forcing new branch creation`);
    // Skip all reuse logic for new issues - always create new branch
    // Force shouldCreateNew to true and bypass all intent detection and search logic
    const entityType = "issue";
    
    // Create Kubernetes-compatible timestamp: lowercase, hyphens only, shorter format
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

    // Ensure branch name is Kubernetes-compatible
    const branchName = `${branchPrefix}${entityType}-${entityNumber}-${timestamp}`;
    const newBranch = branchName.toLowerCase().substring(0, 50);
    
    console.log(`🆕 Creating new branch for new issue: ${newBranch}`);
    
    // Jump directly to the branch creation logic
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
      } else {
        // Create new branch and push immediately
        console.log(
          `Creating and pushing branch ${newBranch} for new issue #${entityNumber} from source branch: ${sourceBranch}...`,
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
      }

      // Set outputs for GitHub Actions
      core.setOutput("CLAUDE_BRANCH", newBranch);
      core.setOutput("BASE_BRANCH", sourceBranch);

      // Setup submodule branches if enabled
      let submoduleBranches: SubmoduleBranchInfo[] = [];
      if (enableSubmoduleBranches !== false) {
        try {
          console.log("Setting up submodule branches...");
          submoduleBranches = await setupSubmoduleBranches(
            newBranch, 
            sourceBranch, 
            effectivePushStrategy,
            "new",
            [] // No submodule search results for new issues
          );
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
        currentBranch: (useCommitSigning && effectivePushStrategy === "deferred") ? sourceBranch : newBranch,
        submoduleBranches,
        pushStrategy: effectivePushStrategy,
        branchReused: false,
        branchSource: "new" as const,
        intentAnalysis: {
          wantsNewBranch: true,
          confidence: 1.0,
          matchedPatterns: ["system: new issue detection"],
          reason: "New issue always creates new branch"
        },
        decisionReason: "New issue - always create new branch",
      };
    } catch (error) {
      console.error("Error creating branch for new issue:", error);
      process.exit(1);
    }
  }
  
  // Simplified logic: Issue-specific branch reuse for existing issues
  console.log(`📋 Applying simplified branch reuse logic for issue #${entityNumber}...`);
  
  // Step 1: Detect user intent from comments
  const intentResult = detectBranchIntentFromComments(
    githubData.comments,
    context.actor
  );
  console.log(`🎯 Intent analysis: ${intentResult.reason}`);
  
  // Step 2: Get recommendation based on intent and configuration
  const strategyRecommendation = getRecommendedBranchStrategy(intentResult, branchReuseStrategy);
  console.log(`💡 Strategy recommendation: ${strategyRecommendation.reason}`);
  
  let searchResult: BranchSearchResult | undefined;
  let shouldCreateNew = strategyRecommendation.shouldCreateNew;
  let decisionReason = strategyRecommendation.reason;
  
  // Step 3: Only search for branches if user didn't explicitly request a new branch
  if (!shouldCreateNew) {
    console.log(`🔍 Searching for existing branches in THIS issue (#${entityNumber}) only...`);
    searchResult = await findLatestClaudeBranch(
      octokits,
      owner,
      repo,
      entityNumber,
      githubData.comments,
      branchPrefix
    );
    
    console.log(`📊 Branch search completed: ${searchResult.totalFound} total branches, looking specifically for issue-${entityNumber} branches`);
    
    if (searchResult.mainBranch) {
      console.log(`🎯 Found candidate branch for this issue: ${searchResult.mainBranch.branchName}`);
      
      // Step 4: Validate the branch for reuse (with more lenient criteria for same-issue branches)
      const validation = await validateBranchForReuse(
        octokits,
        owner,
        repo,
        searchResult.mainBranch.branchName,
        sourceBranch
      );
      
      if (validation.isValid) {
        console.log(`✅ Branch validation successful: ${validation.reason}`);
        decisionReason = `Reusing existing branch from this issue: ${validation.reason}`;
      } else {
        console.log(`❌ Branch validation failed: ${validation.reason}`);
        shouldCreateNew = true;
        decisionReason = `Creating new branch: existing branch not suitable (${validation.reason})`;
      }
    } else {
      console.log(`🆕 No existing branches found for this issue (#${entityNumber}), will create new branch`);
      shouldCreateNew = true;
      decisionReason = "No existing Claude branch found for this specific issue";
    }
  } else {
    console.log(`🆕 User explicitly requested new branch or strategy forces new branch creation`);
  }

  let newBranch: string;
  let branchSource: "new" | "reused" | "error";
  
  // Final decision and logging
  if (!shouldCreateNew && searchResult?.mainBranch) {
    // Reuse existing branch from this issue
    newBranch = searchResult.mainBranch.branchName;
    branchSource = "reused";
    console.log(`♻️ DECISION: Reusing existing branch from issue #${entityNumber}: ${newBranch}`);
    console.log(`📋 Reason: ${decisionReason}`);
  } else {
    // Create new branch
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
    newBranch = branchName.toLowerCase().substring(0, 50);
    branchSource = "new";
    console.log(`🆕 DECISION: Creating new branch for issue #${entityNumber}: ${newBranch}`);
    console.log(`📋 Reason: ${decisionReason}`);
  }

  try {
    // Get the SHA of the source branch to verify it exists
    const sourceBranchRef = await octokits.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${sourceBranch}`,
    });

    const currentSHA = sourceBranchRef.data.object.sha;
    console.log(`Source branch SHA: ${currentSHA}`);

    // Handle branch creation/reuse based on push strategy
    if (effectivePushStrategy === "deferred") {
      if (branchSource === "reused") {
        console.log(`♻️ Checking out existing branch: ${newBranch} (deferred push strategy)`);
        
        // Fetch and checkout the existing branch
        await $`git fetch origin ${newBranch} --depth=1`;
        await $`git checkout ${newBranch}`;
        
        console.log(`✅ Successfully checked out existing branch: ${newBranch}`);
      } else {
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
      }

      // Set outputs for GitHub Actions
      core.setOutput("CLAUDE_BRANCH", newBranch);
      core.setOutput("BASE_BRANCH", sourceBranch);

      // Setup submodule branches if enabled
      let submoduleBranches: SubmoduleBranchInfo[] = [];
      if (enableSubmoduleBranches !== false) {
        try {
          console.log("Setting up submodule branches...");
          // Pass the branch source information to submodule setup
          const submoduleSearchResult = searchResult?.submoduleBranches || [];
          submoduleBranches = await setupSubmoduleBranches(
            newBranch, 
            sourceBranch, 
            effectivePushStrategy,
            branchSource,
            submoduleSearchResult
          );
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
        currentBranch: (useCommitSigning && branchSource === "new") ? sourceBranch : newBranch,
        submoduleBranches,
        pushStrategy: effectivePushStrategy,
        branchReused: branchSource === "reused",
        branchSource,
        intentAnalysis: intentResult,
        searchResult,
        decisionReason,
      };
    }

    // Immediate push strategy: handle both new and reused branches
    if (branchSource === "reused") {
      console.log(`♻️ Checking out existing branch: ${newBranch} (immediate push strategy)`);
      
      // Fetch and checkout the existing branch
      await $`git fetch origin ${newBranch} --depth=1`;
      await $`git checkout ${newBranch}`;
      
      console.log(`✅ Successfully checked out existing branch: ${newBranch}`);
    } else {
      // Create new branch and push immediately
      const entityType = isPR ? "pr" : "issue";
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
    }

    // Set outputs for GitHub Actions
    core.setOutput("CLAUDE_BRANCH", newBranch);
    core.setOutput("BASE_BRANCH", sourceBranch);

    // Setup submodule branches if enabled
    let submoduleBranches: SubmoduleBranchInfo[] = [];
    if (enableSubmoduleBranches !== false) {
      try {
        console.log("Setting up submodule branches...");
        // Pass the branch source information to submodule setup
        const submoduleSearchResult = searchResult?.submoduleBranches || [];
        submoduleBranches = await setupSubmoduleBranches(
          newBranch, 
          sourceBranch, 
          effectivePushStrategy,
          branchSource,
          submoduleSearchResult
        );
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
      branchReused: branchSource === "reused",
      branchSource,
      intentAnalysis: intentResult,
      searchResult,
      decisionReason,
    };
  } catch (error) {
    console.error("Error in branch setup:", error);
    process.exit(1);
  }
}
