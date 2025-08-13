#!/usr/bin/env bun

/**
 * Update the initial tracking comment with branch link
 * This happens after the branch is created for issues
 */

import {
  createJobRunLink,
  createBranchLink,
  createCommentBody,
} from "./common";
import { type Octokits } from "../../api/client";
import {
  isPullRequestReviewCommentEvent,
  type ParsedGitHubContext,
} from "../../context";
import { updateClaudeComment } from "./update-claude-comment";
import { type SubmoduleBranchInfo } from "../submodule";

export async function updateTrackingComment(
  octokit: Octokits,
  context: ParsedGitHubContext,
  commentId: number,
  branch?: string,
  submoduleBranches?: SubmoduleBranchInfo[],
) {
  const { owner, repo } = context.repository;

  const jobRunLink = createJobRunLink(owner, repo, context.runId);

  // Add branch link for issues (not PRs)
  let branchLink = "";
  if (branch && !context.isPR) {
    branchLink = createBranchLink(owner, repo, branch);
  }

  // Add submodule branch information if available
  let submoduleInfo = "";
  if (submoduleBranches && submoduleBranches.length > 0) {
    const successful = submoduleBranches.filter(sb => !sb.error);
    const failed = submoduleBranches.filter(sb => sb.error);
    
    if (successful.length > 0) {
      submoduleInfo += `\n\n### 📦 Submodule Branches\n`;
      submoduleInfo += successful.map(sb => 
        `- **${sb.submodule.name}**: Created branch \`${sb.branchName}\` ${sb.created ? '✅' : '⚠️ (already exists)'}`
      ).join('\n');
    }
    
    if (failed.length > 0) {
      submoduleInfo += `\n\n### ⚠️ Submodule Errors\n`;
      submoduleInfo += failed.map(sb => 
        `- **${sb.submodule.name}**: ${sb.error}`
      ).join('\n');
    }
  }

  const updatedBody = createCommentBody(jobRunLink, branchLink) + submoduleInfo;

  // Update the existing comment with the branch link
  try {
    const isPRReviewComment = isPullRequestReviewCommentEvent(context);

    await updateClaudeComment(octokit.rest, {
      owner,
      repo,
      commentId,
      body: updatedBody,
      isPullRequestReviewComment: isPRReviewComment,
    });

    console.log(
      `✅ Updated ${isPRReviewComment ? "PR review" : "issue"} comment ${commentId} with branch link`,
    );
  } catch (error) {
    console.error("Error updating comment with branch link:", error);
    throw error;
  }
}
