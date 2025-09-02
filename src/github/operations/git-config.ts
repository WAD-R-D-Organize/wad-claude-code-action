#!/usr/bin/env bun

/**
 * Configure git authentication for non-signing mode
 * Sets up git user and authentication to work with GitHub App tokens
 */

import { $ } from "bun";
import type { GitHubContext } from "../context";
import { GITHUB_SERVER_URL } from "../api/config";
import { getSubmodules, type SubmoduleInfo } from "./submodule";

type GitUser = {
  login: string;
  id: number;
};

export async function configureGitAuth(
  githubToken: string,
  context: GitHubContext,
  user: GitUser | null,
) {
  console.log("Configuring git authentication for non-signing mode");

  // Determine the noreply email domain based on GITHUB_SERVER_URL
  const serverUrl = new URL(GITHUB_SERVER_URL);
  const noreplyDomain =
    serverUrl.hostname === "github.com"
      ? "users.noreply.github.com"
      : `users.noreply.${serverUrl.hostname}`;

  // Configure git user based on the comment creator
  console.log("Configuring git user...");
  if (user) {
    const botName = user.login;
    const botId = user.id;
    console.log(`Setting git user as ${botName}...`);
    await $`git config user.name "${botName}"`;
    await $`git config user.email "${botId}+${botName}@${noreplyDomain}"`;
    console.log(`✓ Set git user as ${botName}`);
  } else {
    console.log("No user data in comment, using default bot user");
    await $`git config user.name "github-actions[bot]"`;
    await $`git config user.email "41898282+github-actions[bot]@${noreplyDomain}"`;
  }

  // Remove the authorization header that actions/checkout sets
  console.log("Removing existing git authentication headers...");
  try {
    await $`git config --unset-all http.${GITHUB_SERVER_URL}/.extraheader`;
    console.log("✓ Removed existing authentication headers");
  } catch (e) {
    console.log("No existing authentication headers to remove");
  }

  // Update the remote URL to include the token for authentication
  console.log("Updating remote URL with authentication...");
  const remoteUrl = `https://x-access-token:${githubToken}@${serverUrl.host}/${context.repository.owner}/${context.repository.repo}.git`;
  await $`git remote set-url origin ${remoteUrl}`;
  console.log("✓ Updated remote URL with authentication token");

  // Configure git auth for submodules
  await configureSubmoduleAuth(githubToken, context, user);

  console.log("Git authentication configured successfully");
}

/**
 * Configure git authentication for submodules
 */
export async function configureSubmoduleAuth(
  githubToken: string,
  context: ParsedGitHubContext,
  user: GitUser | null,
) {
  const submodules = await getSubmodules();
  
  if (submodules.length === 0) {
    console.log("No submodules found, skipping submodule auth configuration");
    return;
  }

  console.log(`Configuring git authentication for ${submodules.length} submodules...`);

  // Determine the noreply email domain
  const serverUrl = new URL(GITHUB_SERVER_URL);
  const noreplyDomain =
    serverUrl.hostname === "github.com"
      ? "users.noreply.github.com"
      : `users.noreply.${serverUrl.hostname}`;

  for (const submodule of submodules) {
    try {
      console.log(`Configuring git auth for submodule: ${submodule.path}`);
      
      // Configure git user for each submodule
      if (user) {
        const botName = user.login;
        const botId = user.id;
        await $`cd ${submodule.path} && git config user.name "${botName}"`;
        await $`cd ${submodule.path} && git config user.email "${botId}+${botName}@${noreplyDomain}"`;
      } else {
        await $`cd ${submodule.path} && git config user.name "github-actions[bot]"`;
        await $`cd ${submodule.path} && git config user.email "41898282+github-actions[bot]@${noreplyDomain}"`;
      }

      // Remove existing auth headers for submodule
      try {
        await $`cd ${submodule.path} && git config --unset-all http.${GITHUB_SERVER_URL}/.extraheader`;
      } catch (e) {
        // No existing headers to remove
      }

      // Update submodule remote URL with token authentication
      // Parse the submodule URL to determine if it's a GitHub URL
      const githubMatch = submodule.url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      if (githubMatch) {
        const owner = githubMatch[1];
        const repo = githubMatch[2];
        const authenticatedUrl = `https://x-access-token:${githubToken}@${serverUrl.host}/${owner}/${repo}.git`;
        await $`cd ${submodule.path} && git remote set-url origin ${authenticatedUrl}`;
        console.log(`✓ Configured auth for submodule: ${submodule.path}`);
      } else {
        console.log(`Skipping non-GitHub submodule: ${submodule.path}`);
      }
    } catch (error) {
      console.error(`Failed to configure auth for submodule ${submodule.path}:`, error);
      // Continue with other submodules
    }
  }

  console.log("✓ Submodule authentication configured");
}
