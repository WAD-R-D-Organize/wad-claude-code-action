#!/usr/bin/env bun

/**
 * Branch history detection and management for issue branch reuse
 * Analyzes issue comments and repository branches to find existing Claude branches
 */

import type { Octokits } from "../api/client";
import type { GitHubComment } from "../types";
import type { SubmoduleBranchInfo } from "./submodule";
import { hasSubmodules, parseGitmodules } from "./submodule";

export type HistoricalBranchInfo = {
  branchName: string;
  createdAt?: string;
  lastCommitAt?: string;
  isAvailable: boolean;
  sha?: string;
  source: "comment" | "api";
  commentId?: string;
  author?: string;
};

export type BranchSearchResult = {
  mainBranch?: HistoricalBranchInfo;
  submoduleBranches: Array<{
    submoduleName: string;
    branch?: HistoricalBranchInfo;
  }>;
  totalFound: number;
  searchStrategy: string;
  searchTime: number;
};

// Patterns to detect Claude branch names in comments
const CLAUDE_BRANCH_PATTERNS = [
  // Standard Claude branch pattern
  /\b(claude\/[\w\-]+)\b/gi,
  // Branch links in GitHub comments
  /\/tree\/(claude\/[\w\-]+)\b/gi,
  // Pull request references
  /\/compare\/[\w\-\/]+\.\.\.(claude\/[\w\-]+)\b/gi,
  // Direct branch mentions with backticks
  /`(claude\/[\w\-]+)`/gi,
  // Markdown links to branches
  /\[.*?\]\(.*?\/tree\/(claude\/[\w\-]+)\)/gi,
  // Issue/PR cross-references that might contain branch info
  /(?:from|on|in)\s+branch\s+[`"]?(claude\/[\w\-]+)[`"]?/gi,
];

/**
 * Extract Claude branch names from comment text
 */
function extractBranchNamesFromComment(
  comment: GitHubComment
): Array<{ branchName: string; source: string }> {
  const branchNames: Array<{ branchName: string; source: string }> = [];
  const text = comment.body;

  for (const pattern of CLAUDE_BRANCH_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      // The branch name might be in different capture groups depending on the pattern
      const branchName = match[1] || match[2] || match[0];
      if (branchName && branchName.startsWith("claude/")) {
        branchNames.push({
          branchName: branchName.toLowerCase(),
          source: `comment-${comment.id}`,
        });
      }
    }
  }

  return branchNames;
}

/**
 * Check if a branch exists in the remote repository
 */
async function checkBranchExists(
  octokits: Octokits,
  owner: string,
  repo: string,
  branchName: string
): Promise<{ exists: boolean; sha?: string; lastCommitAt?: string }> {
  try {
    const response = await octokits.rest.repos.getBranch({
      owner,
      repo,
      branch: branchName,
    });

    return {
      exists: true,
      sha: response.data.commit.sha,
      lastCommitAt: response.data.commit.commit.author?.date,
    };
  } catch (error: any) {
    if (error.status === 404) {
      return { exists: false };
    }
    throw error;
  }
}

/**
 * List all Claude branches in the repository
 */
async function listClaudeBranches(
  octokits: Octokits,
  owner: string,
  repo: string,
  branchPrefix: string = "claude/"
): Promise<HistoricalBranchInfo[]> {
  try {
    // Get all branches
    const response = await octokits.rest.repos.listBranches({
      owner,
      repo,
      per_page: 100,
    });

    const claudeBranches: HistoricalBranchInfo[] = [];

    for (const branch of response.data) {
      if (branch.name.startsWith(branchPrefix)) {
        // Get additional commit info
        try {
          const commitResponse = await octokits.rest.repos.getCommit({
            owner,
            repo,
            ref: branch.commit.sha,
          });

          claudeBranches.push({
            branchName: branch.name,
            isAvailable: true,
            sha: branch.commit.sha,
            lastCommitAt: commitResponse.data.commit.author?.date,
            source: "api",
          });
        } catch {
          // If we can't get commit details, still include the branch
          claudeBranches.push({
            branchName: branch.name,
            isAvailable: true,
            sha: branch.commit.sha,
            source: "api",
          });
        }
      }
    }

    return claudeBranches;
  } catch (error) {
    console.warn(`Failed to list branches for ${owner}/${repo}:`, error);
    return [];
  }
}

/**
 * Find the most recent usable Claude branch for an issue
 */
export async function findLatestClaudeBranch(
  octokits: Octokits,
  owner: string,
  repo: string,
  entityNumber: number,
  comments: GitHubComment[],
  branchPrefix: string = "claude/"
): Promise<BranchSearchResult> {
  const startTime = Date.now();
  let searchStrategy = "combined";

  try {
    // Strategy 1: Extract branch names from comments
    const commentBranches = new Map<string, HistoricalBranchInfo>();
    
    for (const comment of comments) {
      // Only look at Claude's own comments or system comments
      if (comment.author.login?.endsWith("[bot]") || 
          comment.author.login === "claude" ||
          comment.body.includes("Created branch") ||
          comment.body.includes("View branch")) {
        
        const extractedBranches = extractBranchNamesFromComment(comment);
        
        for (const { branchName } of extractedBranches) {
          if (!commentBranches.has(branchName)) {
            commentBranches.set(branchName, {
              branchName,
              createdAt: comment.createdAt,
              isAvailable: false, // Will be checked later
              source: "comment",
              commentId: comment.id,
              author: comment.author.login,
            });
          }
        }
      }
    }

    // Strategy 2: List all Claude branches from API
    const apiBranches = await listClaudeBranches(octokits, owner, repo, branchPrefix);
    
    // Combine and deduplicate branches
    const allBranches = new Map<string, HistoricalBranchInfo>();
    
    // Add API branches first (they're confirmed to exist)
    for (const branch of apiBranches) {
      allBranches.set(branch.branchName, branch);
    }
    
    // Add comment branches and check their availability
    for (const [branchName, branchInfo] of commentBranches) {
      if (!allBranches.has(branchName)) {
        // Check if this branch actually exists
        const { exists, sha, lastCommitAt } = await checkBranchExists(
          octokits, 
          owner, 
          repo, 
          branchName
        );
        
        allBranches.set(branchName, {
          ...branchInfo,
          isAvailable: exists,
          sha,
          lastCommitAt,
        });
      }
    }

    // Filter branches related to this issue (by entity number)
    const issueBranches = Array.from(allBranches.values()).filter(branch => {
      // Check if branch name contains the issue/PR number
      const numberPattern = new RegExp(`\\b(?:issue|pr)-${entityNumber}\\b`, 'i');
      return numberPattern.test(branch.branchName);
    });

    // If no issue-specific branches found, consider all Claude branches
    const candidateBranches = issueBranches.length > 0 ? issueBranches : Array.from(allBranches.values());

    // Sort by availability and recency
    const sortedBranches = candidateBranches
      .filter(branch => branch.isAvailable)
      .sort((a, b) => {
        // First sort by availability
        if (a.isAvailable !== b.isAvailable) {
          return b.isAvailable ? 1 : -1;
        }
        
        // Then by last commit time or creation time
        const aTime = a.lastCommitAt || a.createdAt || "1970-01-01";
        const bTime = b.lastCommitAt || b.createdAt || "1970-01-01";
        
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });

    const mainBranch = sortedBranches[0];

    // Handle submodules
    const submoduleBranches: Array<{
      submoduleName: string;
      branch?: HistoricalBranchInfo;
    }> = [];

    if (mainBranch && await hasSubmodules()) {
      try {
        const submodules = await parseGitmodules();
        
        for (const submodule of submodules) {
          // Check if corresponding submodule branch exists
          const submoduleBranchName = mainBranch.branchName;
          
          // Parse submodule URL to get owner/repo
          const urlMatch = submodule.url.match(/github\.com[/:]([\w-]+)\/([\w-]+)/);
          if (urlMatch) {
            const [, subOwner, subRepoName] = urlMatch;
            const subRepo = subRepoName.replace(/\.git$/, "");
            
            try {
              const { exists, sha, lastCommitAt } = await checkBranchExists(
                octokits,
                subOwner,
                subRepo,
                submoduleBranchName
              );
              
              if (exists) {
                submoduleBranches.push({
                  submoduleName: submodule.name,
                  branch: {
                    branchName: submoduleBranchName,
                    isAvailable: true,
                    sha,
                    lastCommitAt,
                    source: "api",
                  },
                });
              } else {
                submoduleBranches.push({
                  submoduleName: submodule.name,
                  branch: undefined,
                });
              }
            } catch (error) {
              console.warn(`Failed to check submodule branch for ${submodule.name}:`, error);
              submoduleBranches.push({
                submoduleName: submodule.name,
                branch: undefined,
              });
            }
          }
        }
      } catch (error) {
        console.warn("Failed to process submodules:", error);
      }
    }

    const searchTime = Date.now() - startTime;
    
    return {
      mainBranch,
      submoduleBranches,
      totalFound: candidateBranches.length,
      searchStrategy,
      searchTime,
    };

  } catch (error) {
    console.error("Error finding latest Claude branch:", error);
    
    return {
      mainBranch: undefined,
      submoduleBranches: [],
      totalFound: 0,
      searchStrategy: "failed",
      searchTime: Date.now() - startTime,
    };
  }
}

/**
 * Validate that a branch is suitable for reuse
 */
export async function validateBranchForReuse(
  octokits: Octokits,
  owner: string,
  repo: string,
  branchName: string,
  baseBranch: string = "main"
): Promise<{
  isValid: boolean;
  reason: string;
  commitsBehind?: number;
  lastActivity?: string;
}> {
  try {
    // Check if branch exists
    const branchExists = await checkBranchExists(octokits, owner, repo, branchName);
    
    if (!branchExists.exists) {
      return {
        isValid: false,
        reason: "Branch no longer exists",
      };
    }

    // Check how far behind the base branch this branch is
    try {
      const comparison = await octokits.rest.repos.compareCommitsWithBasehead({
        owner,
        repo,
        basehead: `${branchName}...${baseBranch}`,
      });
      
      const commitsBehind = comparison.data.behind_by || 0;
      const lastActivity = branchExists.lastCommitAt;
      
      // Consider branch too old if it's more than 50 commits behind
      if (commitsBehind > 50) {
        return {
          isValid: false,
          reason: `Branch is ${commitsBehind} commits behind ${baseBranch}`,
          commitsBehind,
          lastActivity,
        };
      }
      
      // Consider branch stale if no activity for more than 30 days
      if (lastActivity) {
        const daysSinceActivity = (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceActivity > 30) {
          return {
            isValid: false,
            reason: `Branch is stale (${Math.round(daysSinceActivity)} days since last activity)`,
            commitsBehind,
            lastActivity,
          };
        }
      }
      
      return {
        isValid: true,
        reason: "Branch is suitable for reuse",
        commitsBehind,
        lastActivity,
      };
      
    } catch (error) {
      // If comparison fails, assume branch is valid but warn
      return {
        isValid: true,
        reason: "Cannot compare with base branch, assuming valid",
        lastActivity: branchExists.lastCommitAt,
      };
    }
    
  } catch (error) {
    return {
      isValid: false,
      reason: `Error validating branch: ${error}`,
    };
  }
}

/**
 * Get branch history summary for logging/debugging
 */
export function getBranchHistorySummary(result: BranchSearchResult): string {
  const parts = [];
  
  if (result.mainBranch) {
    parts.push(`Main: ${result.mainBranch.branchName} (${result.mainBranch.source})`);
  }
  
  if (result.submoduleBranches.length > 0) {
    const availableSubmodules = result.submoduleBranches.filter(s => s.branch).length;
    parts.push(`Submodules: ${availableSubmodules}/${result.submoduleBranches.length} available`);
  }
  
  parts.push(`Total: ${result.totalFound} branches`);
  parts.push(`Search: ${result.searchTime}ms (${result.searchStrategy})`);
  
  return parts.join(", ");
}