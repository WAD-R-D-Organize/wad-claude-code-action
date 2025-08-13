import type { Octokits } from "../api/client";
import { GITHUB_SERVER_URL } from "../api/config";
import { $ } from "bun";
import { hasSubmodules, getSubmoduleStatus, type SubmoduleBranchInfo } from "./submodule";
import { cleanupBranches, cleanupFailedBranches, type CleanupOptions } from "./branch-cleanup-enhanced";

export async function checkAndCommitOrDeleteBranch(
  octokit: Octokits,
  owner: string,
  repo: string,
  claudeBranch: string | undefined,
  baseBranch: string,
  useCommitSigning: boolean,
): Promise<{ shouldDeleteBranch: boolean; branchLink: string }> {
  let branchLink = "";
  let shouldDeleteBranch = false;

  if (claudeBranch) {
    // First check if the branch exists remotely
    let branchExistsRemotely = false;
    try {
      await octokit.rest.repos.getBranch({
        owner,
        repo,
        branch: claudeBranch,
      });
      branchExistsRemotely = true;
    } catch (error: any) {
      if (error.status === 404) {
        console.log(`Branch ${claudeBranch} does not exist remotely`);
      } else {
        console.error("Error checking if branch exists:", error);
      }
    }

    // Only proceed if branch exists remotely
    if (!branchExistsRemotely) {
      console.log(
        `Branch ${claudeBranch} does not exist remotely, no branch link will be added`,
      );
      return { shouldDeleteBranch: false, branchLink: "" };
    }

    // Check if Claude made any commits to the branch
    try {
      const { data: comparison } =
        await octokit.rest.repos.compareCommitsWithBasehead({
          owner,
          repo,
          basehead: `${baseBranch}...${claudeBranch}`,
        });

      // If there are no commits, check for uncommitted changes if not using commit signing
      if (comparison.total_commits === 0) {
        if (!useCommitSigning) {
          console.log(
            `Branch ${claudeBranch} has no commits from Claude, checking for uncommitted changes...`,
          );

          // Check for uncommitted changes using git status
          try {
            const gitStatus = await $`git status --porcelain`.quiet();
            const hasUncommittedChanges =
              gitStatus.stdout.toString().trim().length > 0;

            if (hasUncommittedChanges) {
              console.log("Found uncommitted changes, committing them...");

              // Add all changes
              await $`git add -A`;

              // Commit with a descriptive message
              const runId = process.env.GITHUB_RUN_ID || "unknown";
              const commitMessage = `Auto-commit: Save uncommitted changes from Claude\n\nRun ID: ${runId}`;
              await $`git commit -m ${commitMessage}`;

              // Push the changes
              await $`git push origin ${claudeBranch}`;

              console.log(
                "✅ Successfully committed and pushed uncommitted changes",
              );

              // Set branch link since we now have commits
              const branchUrl = `${GITHUB_SERVER_URL}/${owner}/${repo}/tree/${claudeBranch}`;
              branchLink = `\n[View branch](${branchUrl})`;
            } else {
              console.log(
                "No uncommitted changes found, marking branch for deletion",
              );
              shouldDeleteBranch = true;
            }
          } catch (gitError) {
            console.error("Error checking/committing changes:", gitError);
            // If we can't check git status, assume the branch might have changes
            const branchUrl = `${GITHUB_SERVER_URL}/${owner}/${repo}/tree/${claudeBranch}`;
            branchLink = `\n[View branch](${branchUrl})`;
          }
        } else {
          console.log(
            `Branch ${claudeBranch} has no commits from Claude, will delete it`,
          );
          shouldDeleteBranch = true;
        }
      } else {
        // Only add branch link if there are commits
        const branchUrl = `${GITHUB_SERVER_URL}/${owner}/${repo}/tree/${claudeBranch}`;
        branchLink = `\n[View branch](${branchUrl})`;
      }
    } catch (error) {
      console.error("Error comparing commits on Claude branch:", error);
      // If we can't compare but the branch exists remotely, include the branch link
      const branchUrl = `${GITHUB_SERVER_URL}/${owner}/${repo}/tree/${claudeBranch}`;
      branchLink = `\n[View branch](${branchUrl})`;
    }
  }

  // Delete the branch if it has no commits
  if (shouldDeleteBranch && claudeBranch) {
    try {
      await octokit.rest.git.deleteRef({
        owner,
        repo,
        ref: `heads/${claudeBranch}`,
      });
      console.log(`✅ Deleted empty branch: ${claudeBranch}`);
    } catch (deleteError) {
      console.error(`Failed to delete branch ${claudeBranch}:`, deleteError);
      // Continue even if deletion fails
    }
  }

  return { shouldDeleteBranch, branchLink };
}

/**
 * Enhanced cleanup function that handles both main repository and submodule branches
 */
export async function enhancedBranchCleanup(
  octokit: Octokits,
  owner: string,
  repo: string,
  claudeBranch: string | undefined,
  baseBranch: string,
  submoduleBranches: SubmoduleBranchInfo[] = [],
  options: CleanupOptions = {}
): Promise<void> {
  console.log("🧹 Starting enhanced branch cleanup process...");
  
  // First, clean up any failed submodule branches
  if (submoduleBranches.some(branch => branch.error)) {
    try {
      await cleanupFailedBranches(submoduleBranches, {
        ...options,
        removeFailedBranches: true,
      });
    } catch (error) {
      console.warn("Failed branches cleanup encountered errors:", error);
    }
  }
  
  // Then run comprehensive cleanup
  try {
    const result = await cleanupBranches(
      claudeBranch,
      baseBranch,
      submoduleBranches,
      {
        removeEmptyBranches: true,
        removeFailedBranches: true,
        dryRun: false,
        ...options,
      }
    );
    
    // Log cleanup results
    if (result.mainRepository) {
      const main = result.mainRepository;
      if (main.cleaned) {
        console.log(`✅ Main repository branch ${main.branchName} was cleaned up: ${main.reason}`);
      } else if (main.error) {
        console.error(`❌ Main repository branch ${main.branchName} cleanup failed: ${main.error}`);
      }
    }
    
    const cleanedSubmodules = result.submodules.filter(sub => sub.cleaned);
    if (cleanedSubmodules.length > 0) {
      console.log(`✅ Cleaned up ${cleanedSubmodules.length} submodule branches`);
    }
    
    const failedSubmodules = result.submodules.filter(sub => sub.error);
    if (failedSubmodules.length > 0) {
      console.warn(`⚠️ ${failedSubmodules.length} submodule branch cleanups failed`);
    }
    
  } catch (error) {
    console.error("Enhanced cleanup failed:", error);
    // Fall back to original cleanup behavior
    console.log("Falling back to original cleanup method...");
    try {
      await checkAndCommitOrDeleteBranch(octokit, owner, repo, claudeBranch, baseBranch, false);
    } catch (fallbackError) {
      console.error("Fallback cleanup also failed:", fallbackError);
    }
  }
}

/**
 * Validate branch health before cleanup
 */
export async function validateBranchHealth(
  octokit: Octokits,
  owner: string,
  repo: string,
  claudeBranch: string | undefined,
  submoduleBranches: SubmoduleBranchInfo[] = []
): Promise<{ healthy: boolean; issues: string[] }> {
  const issues: string[] = [];
  
  // Check main repository branch
  if (claudeBranch) {
    try {
      await octokit.rest.repos.getBranch({
        owner,
        repo,
        branch: claudeBranch,
      });
    } catch (error: any) {
      if (error.status === 404) {
        issues.push(`Main repository branch ${claudeBranch} not found on remote`);
      } else {
        issues.push(`Error checking main repository branch: ${error.message}`);
      }
    }
  }
  
  // Check submodule branches
  for (const subBranch of submoduleBranches) {
    if (subBranch.error) {
      issues.push(`Submodule ${subBranch.submodule.name}: ${subBranch.error}`);
    } else if (!subBranch.pushed) {
      issues.push(`Submodule ${subBranch.submodule.name}: branch not pushed to remote`);
    }
  }
  
  return {
    healthy: issues.length === 0,
    issues,
  };
}
