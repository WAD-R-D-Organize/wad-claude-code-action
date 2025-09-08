#!/usr/bin/env bun

/**
 * Add assignees to an issue or pull request
 * This function handles automatic assignment when Claude starts working
 */

import type { Octokit } from "@octokit/rest";
import type { ParsedGitHubContext } from "../context";

export async function addIssueAssignees(
  octokit: Octokit,
  context: ParsedGitHubContext,
  assignees: string[],
): Promise<void> {
  if (!assignees.length) {
    console.log("No assignees specified, skipping assignment");
    return;
  }

  const { owner, repo } = context.repository;
  const { entityNumber } = context;

  try {
    console.log(
      `Adding assignees to issue/PR #${entityNumber}: ${assignees.join(", ")}`,
    );

    await octokit.rest.issues.addAssignees({
      owner,
      repo,
      issue_number: entityNumber,
      assignees,
    });

    console.log(`✅ Successfully added assignees: ${assignees.join(", ")}`);
  } catch (error) {
    console.error("Error adding assignees:", error);
    // Don't throw error - assignment failure shouldn't block the workflow
    if (error instanceof Error) {
      console.error(`Failed to assign users: ${error.message}`);
    }
  }
}

export function getAssignees(context: ParsedGitHubContext): string[] {
  const { autoAssignUsers } = context.inputs;

  // If custom users are specified, use them
  if (autoAssignUsers.length > 0) {
    return autoAssignUsers;
  }

  // Otherwise, use the issue/PR creator
  try {
    let creator: string;

    switch (context.eventName) {
      case "issues":
        if ("issue" in context.payload) {
          creator = context.payload.issue.user.login;
        } else {
          return [];
        }
        break;
      case "issue_comment":
        if ("issue" in context.payload) {
          creator = context.payload.issue.user.login;
        } else {
          return [];
        }
        break;
      case "pull_request":
        if ("pull_request" in context.payload) {
          creator = context.payload.pull_request.user.login;
        } else {
          return [];
        }
        break;
      case "pull_request_review":
        if ("pull_request" in context.payload) {
          creator = context.payload.pull_request.user.login;
        } else {
          return [];
        }
        break;
      case "pull_request_review_comment":
        if ("pull_request" in context.payload) {
          creator = context.payload.pull_request.user.login;
        } else {
          return [];
        }
        break;
      default:
        console.log(
          "Unable to determine creator for event type:",
          context.eventName,
        );
        return [];
    }

    return [creator];
  } catch (error) {
    console.error("Error determining issue/PR creator:", error);
    return [];
  }
}