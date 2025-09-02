#!/usr/bin/env node
// GitHub File Operations MCP Server
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, stat } from "fs/promises";
import { join } from "path";
import { constants } from "fs";
import fetch from "node-fetch";
import { GITHUB_API_URL } from "../github/api/config";
import { retryWithBackoff } from "../utils/retry";

type GitHubRef = {
  object: {
    sha: string;
  };
};

type GitHubCommit = {
  tree: {
    sha: string;
  };
};

type GitHubTree = {
  sha: string;
};

type GitHubNewCommit = {
  sha: string;
  message: string;
  author: {
    name: string;
    date: string;
  };
};

// Get repository information from environment variables
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const BRANCH_NAME = process.env.BRANCH_NAME;
const REPO_DIR = process.env.REPO_DIR || process.cwd();

if (!REPO_OWNER || !REPO_NAME || !BRANCH_NAME) {
  console.error(
    "Error: REPO_OWNER, REPO_NAME, and BRANCH_NAME environment variables are required",
  );
  process.exit(1);
}

const server = new McpServer({
  name: "GitHub File Operations Server",
  version: "0.0.1",
});

// Submodule support types and helpers
type SubmoduleInfo = {
  path: string;
  url: string;
  branch?: string;
};

// Parse .gitmodules file to get submodule information
async function getSubmodules(): Promise<SubmoduleInfo[]> {
  try {
    const gitmodulesPath = join(REPO_DIR, ".gitmodules");
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
    return [];
  }
}

// Check if a file path is within a submodule
function getSubmoduleForPath(filePath: string, submodules: SubmoduleInfo[]): SubmoduleInfo | null {
  const normalizedPath = filePath.replace(/^\/+/, "");
  
  for (const submodule of submodules) {
    if (normalizedPath.startsWith(submodule.path + "/") || normalizedPath === submodule.path) {
      return submodule;
    }
  }
  
  return null;
}

// Extract owner/repo from GitHub URL
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const githubMatch = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (githubMatch) {
    return {
      owner: githubMatch[1],
      repo: githubMatch[2],
    };
  }
  return null;
}

// Helper function to get or create branch reference
async function getOrCreateBranchRef(
  owner: string,
  repo: string,
  branch: string,
  githubToken: string,
): Promise<string> {
  // Try to get the branch reference
  const refUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${branch}`;
  const refResponse = await fetch(refUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (refResponse.ok) {
    const refData = (await refResponse.json()) as GitHubRef;
    return refData.object.sha;
  }

  if (refResponse.status !== 404) {
    throw new Error(`Failed to get branch reference: ${refResponse.status}`);
  }

  const baseBranch = process.env.BASE_BRANCH!;

  // Get the SHA of the base branch
  const baseRefUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${baseBranch}`;
  const baseRefResponse = await fetch(baseRefUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  let baseSha: string;

  if (!baseRefResponse.ok) {
    // If base branch doesn't exist, try default branch
    const repoUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}`;
    const repoResponse = await fetch(repoUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!repoResponse.ok) {
      throw new Error(`Failed to get repository info: ${repoResponse.status}`);
    }

    const repoData = (await repoResponse.json()) as {
      default_branch: string;
    };
    const defaultBranch = repoData.default_branch;

    // Try default branch
    const defaultRefUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`;
    const defaultRefResponse = await fetch(defaultRefUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!defaultRefResponse.ok) {
      throw new Error(
        `Failed to get default branch reference: ${defaultRefResponse.status}`,
      );
    }

    const defaultRefData = (await defaultRefResponse.json()) as GitHubRef;
    baseSha = defaultRefData.object.sha;
  } else {
    const baseRefData = (await baseRefResponse.json()) as GitHubRef;
    baseSha = baseRefData.object.sha;
  }

  // Create the new branch using the same pattern as octokit
  const createRefUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs`;
  const createRefResponse = await fetch(createRefUrl, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: `refs/heads/${branch}`,
      sha: baseSha,
    }),
  });

  if (!createRefResponse.ok) {
    const errorText = await createRefResponse.text();
    throw new Error(
      `Failed to create branch: ${createRefResponse.status} - ${errorText}`,
    );
  }

  console.log(`Successfully created branch ${branch}`);
  return baseSha;
}

// Get the appropriate Git file mode for a file
async function getFileMode(filePath: string): Promise<string> {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) {
      // Check if execute bit is set for user
      if (fileStat.mode & constants.S_IXUSR) {
        return "100755"; // Executable file
      } else {
        return "100644"; // Regular file
      }
    } else if (fileStat.isDirectory()) {
      return "040000"; // Directory (tree)
    } else if (fileStat.isSymbolicLink()) {
      return "120000"; // Symbolic link
    } else {
      // Fallback for unknown file types
      return "100644";
    }
  } catch (error) {
    // If we can't stat the file, default to regular file
    console.warn(
      `Could not determine file mode for ${filePath}, using default: ${error}`,
    );
    return "100644";
  }
}

// Commit files tool
server.tool(
  "commit_files",
  "Commit one or more files to a repository in a single commit (this will commit them atomically in the remote repository)",
  {
    files: z
      .array(z.string())
      .describe(
        'Array of file paths relative to repository root (e.g. ["src/main.js", "README.md"]). All files must exist locally.',
      ),
    message: z.string().describe("Commit message"),
  },
  async ({ files, message }) => {
    const owner = REPO_OWNER;
    const repo = REPO_NAME;
    const branch = BRANCH_NAME;
    try {
      const githubToken = process.env.GITHUB_TOKEN;
      if (!githubToken) {
        throw new Error("GITHUB_TOKEN environment variable is required");
      }

      const processedFiles = files.map((filePath) => {
        if (filePath.startsWith("/")) {
          return filePath.slice(1);
        }
        return filePath;
      });

      // 1. Get the branch reference (create if doesn't exist)
      const baseSha = await getOrCreateBranchRef(
        owner,
        repo,
        branch,
        githubToken,
      );

      // 2. Get the base commit
      const commitUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits/${baseSha}`;
      const commitResponse = await fetch(commitUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (!commitResponse.ok) {
        throw new Error(`Failed to get base commit: ${commitResponse.status}`);
      }

      const commitData = (await commitResponse.json()) as GitHubCommit;
      const baseTreeSha = commitData.tree.sha;

      // 3. Create tree entries for all files
      const treeEntries = await Promise.all(
        processedFiles.map(async (filePath) => {
          const fullPath = filePath.startsWith("/")
            ? filePath
            : join(REPO_DIR, filePath);

          // Get the proper file mode based on file permissions
          const fileMode = await getFileMode(fullPath);

          // Check if file is binary (images, etc.)
          const isBinaryFile =
            /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|tar|gz|exe|bin|woff|woff2|ttf|eot)$/i.test(
              filePath,
            );

          if (isBinaryFile) {
            // For binary files, create a blob first using the Blobs API
            const binaryContent = await readFile(fullPath);

            // Create blob using Blobs API (supports encoding parameter)
            const blobUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/blobs`;
            const blobResponse = await fetch(blobUrl, {
              method: "POST",
              headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${githubToken}`,
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                content: binaryContent.toString("base64"),
                encoding: "base64",
              }),
            });

            if (!blobResponse.ok) {
              const errorText = await blobResponse.text();
              throw new Error(
                `Failed to create blob for ${filePath}: ${blobResponse.status} - ${errorText}`,
              );
            }

            const blobData = (await blobResponse.json()) as { sha: string };

            // Return tree entry with blob SHA
            return {
              path: filePath,
              mode: fileMode,
              type: "blob",
              sha: blobData.sha,
            };
          } else {
            // For text files, include content directly in tree
            const content = await readFile(fullPath, "utf-8");
            return {
              path: filePath,
              mode: fileMode,
              type: "blob",
              content: content,
            };
          }
        }),
      );

      // 4. Create a new tree
      const treeUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/trees`;
      const treeResponse = await fetch(treeUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeEntries,
        }),
      });

      if (!treeResponse.ok) {
        const errorText = await treeResponse.text();
        throw new Error(
          `Failed to create tree: ${treeResponse.status} - ${errorText}`,
        );
      }

      const treeData = (await treeResponse.json()) as GitHubTree;

      // 5. Create a new commit
      const newCommitUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits`;
      const newCommitResponse = await fetch(newCommitUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: message,
          tree: treeData.sha,
          parents: [baseSha],
        }),
      });

      if (!newCommitResponse.ok) {
        const errorText = await newCommitResponse.text();
        throw new Error(
          `Failed to create commit: ${newCommitResponse.status} - ${errorText}`,
        );
      }

      const newCommitData = (await newCommitResponse.json()) as GitHubNewCommit;

      // 6. Update the reference to point to the new commit
      const updateRefUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${branch}`;

      // We're seeing intermittent 403 "Resource not accessible by integration" errors
      // on certain repos when updating git references. These appear to be transient
      // GitHub API issues that succeed on retry.
      await retryWithBackoff(
        async () => {
          const updateRefResponse = await fetch(updateRefUrl, {
            method: "PATCH",
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${githubToken}`,
              "X-GitHub-Api-Version": "2022-11-28",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              sha: newCommitData.sha,
              force: false,
            }),
          });

          if (!updateRefResponse.ok) {
            const errorText = await updateRefResponse.text();

            // Provide a more helpful error message for 403 permission errors
            if (updateRefResponse.status === 403) {
              const permissionError = new Error(
                `Permission denied: Unable to push commits to branch '${branch}'. ` +
                  `Please rebase your branch from the main/master branch to allow Claude to commit.\n\n` +
                  `Original error: ${errorText}`,
              );
              throw permissionError;
            }

            // For other errors, use the original message
            const error = new Error(
              `Failed to update reference: ${updateRefResponse.status} - ${errorText}`,
            );

            // For non-403 errors, fail immediately without retry
            console.error("Non-retryable error:", updateRefResponse.status);
            throw error;
          }
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1000, // Start with 1 second delay
          maxDelayMs: 5000, // Max 5 seconds delay
          backoffFactor: 2, // Double the delay each time
        },
      );

      const simplifiedResult = {
        commit: {
          sha: newCommitData.sha,
          message: newCommitData.message,
          author: newCommitData.author.name,
          date: newCommitData.author.date,
        },
        files: processedFiles.map((path) => ({ path })),
        tree: {
          sha: treeData.sha,
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(simplifiedResult, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${errorMessage}`,
          },
        ],
        error: errorMessage,
        isError: true,
      };
    }
  },
);

// Delete files tool
server.tool(
  "delete_files",
  "Delete one or more files from a repository in a single commit",
  {
    paths: z
      .array(z.string())
      .describe(
        'Array of file paths to delete relative to repository root (e.g. ["src/old-file.js", "docs/deprecated.md"])',
      ),
    message: z.string().describe("Commit message"),
  },
  async ({ paths, message }) => {
    const owner = REPO_OWNER;
    const repo = REPO_NAME;
    const branch = BRANCH_NAME;
    try {
      const githubToken = process.env.GITHUB_TOKEN;
      if (!githubToken) {
        throw new Error("GITHUB_TOKEN environment variable is required");
      }

      // Convert absolute paths to relative if they match CWD
      const cwd = process.cwd();
      const processedPaths = paths.map((filePath) => {
        if (filePath.startsWith("/")) {
          if (filePath.startsWith(cwd)) {
            // Strip CWD from absolute path
            return filePath.slice(cwd.length + 1);
          } else {
            throw new Error(
              `Path '${filePath}' must be relative to repository root or within current working directory`,
            );
          }
        }
        return filePath;
      });

      // 1. Get the branch reference (create if doesn't exist)
      const baseSha = await getOrCreateBranchRef(
        owner,
        repo,
        branch,
        githubToken,
      );

      // 2. Get the base commit
      const commitUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits/${baseSha}`;
      const commitResponse = await fetch(commitUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (!commitResponse.ok) {
        throw new Error(`Failed to get base commit: ${commitResponse.status}`);
      }

      const commitData = (await commitResponse.json()) as GitHubCommit;
      const baseTreeSha = commitData.tree.sha;

      // 3. Create tree entries for file deletions (setting SHA to null)
      const treeEntries = processedPaths.map((path) => ({
        path: path,
        mode: "100644",
        type: "blob" as const,
        sha: null,
      }));

      // 4. Create a new tree with deletions
      const treeUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/trees`;
      const treeResponse = await fetch(treeUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeEntries,
        }),
      });

      if (!treeResponse.ok) {
        const errorText = await treeResponse.text();
        throw new Error(
          `Failed to create tree: ${treeResponse.status} - ${errorText}`,
        );
      }

      const treeData = (await treeResponse.json()) as GitHubTree;

      // 5. Create a new commit
      const newCommitUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits`;
      const newCommitResponse = await fetch(newCommitUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: message,
          tree: treeData.sha,
          parents: [baseSha],
        }),
      });

      if (!newCommitResponse.ok) {
        const errorText = await newCommitResponse.text();
        throw new Error(
          `Failed to create commit: ${newCommitResponse.status} - ${errorText}`,
        );
      }

      const newCommitData = (await newCommitResponse.json()) as GitHubNewCommit;

      // 6. Update the reference to point to the new commit
      const updateRefUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${branch}`;

      // We're seeing intermittent 403 "Resource not accessible by integration" errors
      // on certain repos when updating git references. These appear to be transient
      // GitHub API issues that succeed on retry.
      await retryWithBackoff(
        async () => {
          const updateRefResponse = await fetch(updateRefUrl, {
            method: "PATCH",
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${githubToken}`,
              "X-GitHub-Api-Version": "2022-11-28",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              sha: newCommitData.sha,
              force: false,
            }),
          });

          if (!updateRefResponse.ok) {
            const errorText = await updateRefResponse.text();

            // Provide a more helpful error message for 403 permission errors
            if (updateRefResponse.status === 403) {
              console.log("Received 403 error, will retry...");
              const permissionError = new Error(
                `Permission denied: Unable to push commits to branch '${branch}'. ` +
                  `Please rebase your branch from the main/master branch to allow Claude to commit.\n\n` +
                  `Original error: ${errorText}`,
              );
              throw permissionError;
            }

            // For other errors, use the original message
            const error = new Error(
              `Failed to update reference: ${updateRefResponse.status} - ${errorText}`,
            );

            // For non-403 errors, fail immediately without retry
            console.error("Non-retryable error:", updateRefResponse.status);
            throw error;
          }
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1000, // Start with 1 second delay
          maxDelayMs: 5000, // Max 5 seconds delay
          backoffFactor: 2, // Double the delay each time
        },
      );

      const simplifiedResult = {
        commit: {
          sha: newCommitData.sha,
          message: newCommitData.message,
          author: newCommitData.author.name,
          date: newCommitData.author.date,
        },
        deletedFiles: processedPaths.map((path) => ({ path })),
        tree: {
          sha: treeData.sha,
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(simplifiedResult, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${errorMessage}`,
          },
        ],
        error: errorMessage,
        isError: true,
      };
    }
  },
);

// Commit files to submodule tool
server.tool(
  "commit_submodule_files",
  "Commit files to a submodule and update parent repository's submodule reference",
  {
    submodule_path: z.string().describe("Path to the submodule (e.g. 'libs/my-submodule')"),
    files: z
      .array(z.string())
      .describe(
        'Array of file paths relative to submodule root (e.g. ["src/main.js", "README.md"]). All files must exist locally.',
      ),
    message: z.string().describe("Commit message for the submodule"),
    parent_message: z.string().describe("Commit message for updating the parent repository's submodule reference"),
  },
  async ({ submodule_path, files, message, parent_message }) => {
    try {
      const githubToken = process.env.GITHUB_TOKEN;
      if (!githubToken) {
        throw new Error("GITHUB_TOKEN environment variable is required");
      }

      // Get submodule info
      const submodules = await getSubmodules();
      const submodule = submodules.find(s => s.path === submodule_path);
      
      if (!submodule) {
        throw new Error(`Submodule not found at path: ${submodule_path}`);
      }

      // Parse submodule URL to get owner/repo
      const submoduleRepo = parseGitHubUrl(submodule.url);
      if (!submoduleRepo) {
        throw new Error(`Could not parse GitHub URL for submodule: ${submodule.url}`);
      }

      // Process file paths relative to submodule
      const processedFiles = files.map((filePath) => {
        if (filePath.startsWith("/")) {
          return filePath.slice(1);
        }
        return filePath;
      });

      // 1. Commit to submodule repository
      const submoduleBaseSha = await getOrCreateBranchRef(
        submoduleRepo.owner,
        submoduleRepo.repo,
        BRANCH_NAME,
        githubToken,
      );

      // 2. Get the base commit for submodule
      const submoduleCommitUrl = `${GITHUB_API_URL}/repos/${submoduleRepo.owner}/${submoduleRepo.repo}/git/commits/${submoduleBaseSha}`;
      const submoduleCommitResponse = await fetch(submoduleCommitUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (!submoduleCommitResponse.ok) {
        throw new Error(`Failed to get submodule base commit: ${submoduleCommitResponse.status}`);
      }

      const submoduleCommitData = (await submoduleCommitResponse.json()) as GitHubCommit;
      const submoduleBaseTreeSha = submoduleCommitData.tree.sha;

      // 3. Create tree entries for submodule files
      const submoduleTreeEntries = await Promise.all(
        processedFiles.map(async (filePath) => {
          const fullPath = join(REPO_DIR, submodule_path, filePath);

          // Check if file is binary
          const isBinaryFile =
            /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|tar|gz|exe|bin|woff|woff2|ttf|eot)$/i.test(
              filePath,
            );

          if (isBinaryFile) {
            // For binary files, create a blob first
            const binaryContent = await readFile(fullPath);

            const blobUrl = `${GITHUB_API_URL}/repos/${submoduleRepo.owner}/${submoduleRepo.repo}/git/blobs`;
            const blobResponse = await fetch(blobUrl, {
              method: "POST",
              headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${githubToken}`,
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                content: binaryContent.toString("base64"),
                encoding: "base64",
              }),
            });

            if (!blobResponse.ok) {
              const errorText = await blobResponse.text();
              throw new Error(
                `Failed to create blob for ${filePath}: ${blobResponse.status} - ${errorText}`,
              );
            }

            const blobData = (await blobResponse.json()) as { sha: string };

            return {
              path: filePath,
              mode: "100644",
              type: "blob",
              sha: blobData.sha,
            };
          } else {
            // For text files, include content directly
            const content = await readFile(fullPath, "utf-8");
            return {
              path: filePath,
              mode: "100644",
              type: "blob",
              content: content,
            };
          }
        }),
      );

      // 4. Create new tree for submodule
      const submoduleTreeUrl = `${GITHUB_API_URL}/repos/${submoduleRepo.owner}/${submoduleRepo.repo}/git/trees`;
      const submoduleTreeResponse = await fetch(submoduleTreeUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          base_tree: submoduleBaseTreeSha,
          tree: submoduleTreeEntries,
        }),
      });

      if (!submoduleTreeResponse.ok) {
        const errorText = await submoduleTreeResponse.text();
        throw new Error(
          `Failed to create submodule tree: ${submoduleTreeResponse.status} - ${errorText}`,
        );
      }

      const submoduleTreeData = (await submoduleTreeResponse.json()) as GitHubTree;

      // 5. Create new commit in submodule
      const submoduleNewCommitUrl = `${GITHUB_API_URL}/repos/${submoduleRepo.owner}/${submoduleRepo.repo}/git/commits`;
      const submoduleNewCommitResponse = await fetch(submoduleNewCommitUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: message,
          tree: submoduleTreeData.sha,
          parents: [submoduleBaseSha],
        }),
      });

      if (!submoduleNewCommitResponse.ok) {
        const errorText = await submoduleNewCommitResponse.text();
        throw new Error(
          `Failed to create submodule commit: ${submoduleNewCommitResponse.status} - ${errorText}`,
        );
      }

      const submoduleNewCommitData = (await submoduleNewCommitResponse.json()) as GitHubNewCommit;

      // 6. Update submodule branch reference
      const submoduleUpdateRefUrl = `${GITHUB_API_URL}/repos/${submoduleRepo.owner}/${submoduleRepo.repo}/git/refs/heads/${BRANCH_NAME}`;
      
      await retryWithBackoff(
        async () => {
          const submoduleUpdateRefResponse = await fetch(submoduleUpdateRefUrl, {
            method: "PATCH",
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${githubToken}`,
              "X-GitHub-Api-Version": "2022-11-28",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              sha: submoduleNewCommitData.sha,
              force: false,
            }),
          });

          if (!submoduleUpdateRefResponse.ok) {
            const errorText = await submoduleUpdateRefResponse.text();
            const error = new Error(
              `Failed to update submodule reference: ${submoduleUpdateRefResponse.status} - ${errorText}`,
            );

            if (submoduleUpdateRefResponse.status === 403) {
              throw error;
            }

            console.error("Non-retryable error:", submoduleUpdateRefResponse.status);
            throw error;
          }
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1000,
          maxDelayMs: 5000,
          backoffFactor: 2,
        },
      );

      // 7. Now update parent repository's submodule reference
      const owner = REPO_OWNER;
      const repo = REPO_NAME;
      const branch = BRANCH_NAME;

      // Get parent repository base commit
      const parentBaseSha = await getOrCreateBranchRef(owner, repo, branch, githubToken);
      
      const parentCommitUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits/${parentBaseSha}`;
      const parentCommitResponse = await fetch(parentCommitUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (!parentCommitResponse.ok) {
        throw new Error(`Failed to get parent base commit: ${parentCommitResponse.status}`);
      }

      const parentCommitData = (await parentCommitResponse.json()) as GitHubCommit;
      const parentBaseTreeSha = parentCommitData.tree.sha;

      // Create tree entry for submodule reference update
      const parentTreeEntries = [
        {
          path: submodule_path,
          mode: "160000", // Gitlink mode for submodules
          type: "commit",
          sha: submoduleNewCommitData.sha,
        },
      ];

      // Create new tree for parent
      const parentTreeUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/trees`;
      const parentTreeResponse = await fetch(parentTreeUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          base_tree: parentBaseTreeSha,
          tree: parentTreeEntries,
        }),
      });

      if (!parentTreeResponse.ok) {
        const errorText = await parentTreeResponse.text();
        throw new Error(
          `Failed to create parent tree: ${parentTreeResponse.status} - ${errorText}`,
        );
      }

      const parentTreeData = (await parentTreeResponse.json()) as GitHubTree;

      // Create new commit in parent
      const parentNewCommitUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits`;
      const parentNewCommitResponse = await fetch(parentNewCommitUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: parent_message,
          tree: parentTreeData.sha,
          parents: [parentBaseSha],
        }),
      });

      if (!parentNewCommitResponse.ok) {
        const errorText = await parentNewCommitResponse.text();
        throw new Error(
          `Failed to create parent commit: ${parentNewCommitResponse.status} - ${errorText}`,
        );
      }

      const parentNewCommitData = (await parentNewCommitResponse.json()) as GitHubNewCommit;

      // Update parent branch reference
      const parentUpdateRefUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${branch}`;
      
      await retryWithBackoff(
        async () => {
          const parentUpdateRefResponse = await fetch(parentUpdateRefUrl, {
            method: "PATCH",
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${githubToken}`,
              "X-GitHub-Api-Version": "2022-11-28",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              sha: parentNewCommitData.sha,
              force: false,
            }),
          });

          if (!parentUpdateRefResponse.ok) {
            const errorText = await parentUpdateRefResponse.text();
            const error = new Error(
              `Failed to update parent reference: ${parentUpdateRefResponse.status} - ${errorText}`,
            );

            if (parentUpdateRefResponse.status === 403) {
              throw error;
            }

            console.error("Non-retryable error:", parentUpdateRefResponse.status);
            throw error;
          }
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1000,
          maxDelayMs: 5000,
          backoffFactor: 2,
        },
      );

      const result = {
        submodule: {
          path: submodule_path,
          commit: {
            sha: submoduleNewCommitData.sha,
            message: submoduleNewCommitData.message,
            author: submoduleNewCommitData.author.name,
            date: submoduleNewCommitData.author.date,
          },
          files: processedFiles.map((path) => ({ path })),
        },
        parent: {
          commit: {
            sha: parentNewCommitData.sha,
            message: parentNewCommitData.message,
            author: parentNewCommitData.author.name,
            date: parentNewCommitData.author.date,
          },
          submodule_reference: submoduleNewCommitData.sha,
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${errorMessage}`,
          },
        ],
        error: errorMessage,
        isError: true,
      };
    }
  },
);

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on("exit", () => {
    server.close();
  });
}

runServer().catch(console.error);
