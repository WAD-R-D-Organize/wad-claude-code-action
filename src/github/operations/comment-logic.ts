import { GITHUB_SERVER_URL } from "../api/config";

export type ExecutionDetails = {
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
};

export type CommentUpdateInput = {
  currentBody: string;
  actionFailed: boolean;
  executionDetails: ExecutionDetails | null;
  jobUrl: string;
  branchLink?: string;
  prLink?: string;
  branchName?: string;
  triggerUsername?: string;
  errorDetails?: string;
};

export function ensureProperlyEncodedUrl(url: string): string | null {
  try {
    // First, try to parse the URL to see if it's already properly encoded
    new URL(url);
    if (url.includes(" ")) {
      const [baseUrl, queryString] = url.split("?");
      if (queryString) {
        // Parse query parameters and re-encode them properly
        const params = new URLSearchParams();
        const pairs = queryString.split("&");
        for (const pair of pairs) {
          const [key, value = ""] = pair.split("=");
          if (key) {
            // Decode first in case it's partially encoded, then encode properly
            params.set(key, decodeURIComponent(value));
          }
        }
        return `${baseUrl}?${params.toString()}`;
      }
      // If no query string, just encode spaces
      return url.replace(/ /g, "%20");
    }
    return url;
  } catch (e) {
    // If URL parsing fails, try basic fixes
    try {
      // Replace spaces with %20
      let fixedUrl = url.replace(/ /g, "%20");

      // Ensure colons in parameter values are encoded (but not in http:// or after domain)
      const urlParts = fixedUrl.split("?");
      if (urlParts.length > 1 && urlParts[1]) {
        const [baseUrl, queryString] = urlParts;
        // Encode colons in the query string that aren't already encoded
        const fixedQuery = queryString.replace(/([^%]|^):(?!%2F%2F)/g, "$1%3A");
        fixedUrl = `${baseUrl}?${fixedQuery}`;
      }

      // Try to validate the fixed URL
      new URL(fixedUrl);
      return fixedUrl;
    } catch {
      // If we still can't create a valid URL, return null
      return null;
    }
  }
}

export function updateCommentBody(input: CommentUpdateInput): string {
  const originalBody = input.currentBody;
  const {
    executionDetails,
    jobUrl,
    branchLink,
    prLink,
    actionFailed,
    branchName,
    triggerUsername,
    errorDetails,
  } = input;

  // Extract content from the original comment body
  // First, remove the "Claude Code is working…" or "Claude Code is working..." message
  const workingPattern = /Claude Code is working[…\.]{1,3}(?:\s*<img[^>]*>)?/i;
  let bodyContent = originalBody.replace(workingPattern, "").trim();

  // Check if there's a PRLink block in the content
  let mainRepoPRLink = "";
  let submodulePRLinks: Array<{ name: string; url: string }> = [];

  // Find PRLink block
  const prLinkBlockPattern = /===PRLink Start===\n([\s\S]*?)\n===PRLink End===/;
  const prLinkBlockMatch = bodyContent.match(prLinkBlockPattern);

  if (prLinkBlockMatch) {
    const prLinksContent = prLinkBlockMatch[1];
    
    // Parse main repository PR link - handle URLs with parentheses in them
    const mainPRPattern = /\[Create a PR\]\((https?:\/\/[^\s]+)\)/;
    const mainMatch = prLinksContent.match(mainPRPattern);
    if (mainMatch && mainMatch[1]) {
      const encodedUrl = ensureProperlyEncodedUrl(mainMatch[1]);
      if (encodedUrl) {
        mainRepoPRLink = encodedUrl;
      }
    }
    
    // Parse submodule PR links - handle URLs with parentheses in them
    const submodulePRPattern = /\[Create PR for ([^\]]+)\]\((https?:\/\/[^\s]+)\)/g;
    let subMatch;
    while ((subMatch = submodulePRPattern.exec(prLinksContent)) !== null) {
      if (subMatch[1] && subMatch[2]) {
        const encodedUrl = ensureProperlyEncodedUrl(subMatch[2]);
        if (encodedUrl) {
          submodulePRLinks.push({
            name: subMatch[1],
            url: encodedUrl
          });
        }
      }
    }
    
    // Remove the entire PRLink block from the content
    bodyContent = bodyContent.replace(prLinkBlockMatch[0], "").trim();
  }

  // Fallback to old PR link pattern for backward compatibility
  let prLinkFromContent = "";
  if (!mainRepoPRLink) {
    const prLinkPattern = /\[Create .* PR\]\((.*)\)$/m;
    const prLinkMatch = bodyContent.match(prLinkPattern);

    if (prLinkMatch && prLinkMatch[1]) {
      const encodedUrl = ensureProperlyEncodedUrl(prLinkMatch[1]);
      if (encodedUrl) {
        prLinkFromContent = encodedUrl;
        // Remove the PR link from the content
        bodyContent = bodyContent.replace(prLinkMatch[0], "").trim();
      }
    }
  }

  // Calculate duration string if available
  let durationStr = "";
  if (executionDetails?.duration_ms !== undefined) {
    const totalSeconds = Math.round(executionDetails.duration_ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  // Build the header
  let header = "";

  if (actionFailed) {
    header = "**Claude 遇到錯誤";
    if (durationStr) {
      header += ` (${durationStr} 後)`;
    }
    header += "**";
  } else {
    // Get the username from triggerUsername or extract from content
    const usernameMatch = bodyContent.match(/@([a-zA-Z0-9-]+)/);
    const username =
      triggerUsername || (usernameMatch ? usernameMatch[1] : "user");

    header = `**Claude 已完成 @${username} 的任務`;
    if (durationStr) {
      header += ` (耗時 ${durationStr})`;
    }
    header += "**";
  }

  // Add links section
  let links = ` —— [檢視工作](${jobUrl})`;

  // Extract branch information
  let finalBranchName = branchName;
  let branchUrl = "";

  if (branchLink) {
    // Extract the branch URL from the link
    const urlMatch = branchLink.match(/\((https:\/\/.*)\)/);
    if (urlMatch && urlMatch[1]) {
      branchUrl = urlMatch[1];
    }

    // Extract branch name from link if not provided
    if (!finalBranchName) {
      const branchNameMatch = branchLink.match(/tree\/([^"'\)]+)/);
      if (branchNameMatch) {
        finalBranchName = branchNameMatch[1];
      }
    }
  }

  // If we don't have a URL yet but have a branch name, construct it
  if (!branchUrl && finalBranchName) {
    // Extract owner/repo from jobUrl
    const repoMatch = jobUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\//);
    if (repoMatch) {
      branchUrl = `${GITHUB_SERVER_URL}/${repoMatch[1]}/${repoMatch[2]}/tree/${finalBranchName}`;
    }
  }

  // Add PR links - support both new PRLink block format and legacy format
  const prUrl =
    mainRepoPRLink || prLinkFromContent || (prLink ? prLink.match(/\(([^)]+)\)/)?.[1] : "");
  
  // If we have PRLink block format (main repo + submodules)
  if (mainRepoPRLink || submodulePRLinks.length > 0) {
    // Multi-line format for PRLink block
    if (finalBranchName && branchUrl) {
      links += "\n\n主倉庫：[`" + finalBranchName + "`](" + branchUrl + ")";
      if (mainRepoPRLink) {
        links += " • [建立 PR ➔](" + mainRepoPRLink + ")";
      }
    }
    
    if (submodulePRLinks.length > 0) {
      links += "\n子模組：";
      for (const submodule of submodulePRLinks) {
        links += "\n- " + submodule.name + "：";
        
        // Extract repository info from submodule PR URL to build correct branch URL
        const submoduleRepoMatch = submodule.url.match(/github\.com\/([^\/]+)\/([^\/]+)\//);
        if (finalBranchName && submoduleRepoMatch) {
          // Build submodule-specific branch URL
          const submoduleBranchUrl = `${GITHUB_SERVER_URL}/${submoduleRepoMatch[1]}/${submoduleRepoMatch[2]}/tree/${finalBranchName}`;
          links += "[`" + finalBranchName + "`](" + submoduleBranchUrl + ")";
        } else if (finalBranchName) {
          links += "`" + finalBranchName + "`";
        }
        
        links += " • [建立 PR ➔](" + submodule.url + ")";
      }
    }
  } else {
    // Legacy single-line format
    if (finalBranchName && branchUrl) {
      links += ` • [\`${finalBranchName}\`](${branchUrl})`;
    } else if (finalBranchName) {
      links += ` • \`${finalBranchName}\``;
    }
    
    if (prUrl) {
      links += ` • [建立 PR ➔](${prUrl})`;
    }
  }

  // Build the new body with blank line between header and separator
  let newBody = `${header}${links}`;

  // Add error details if available
  if (actionFailed && errorDetails) {
    newBody += `\n\n\`\`\`\n${errorDetails}\n\`\`\``;
  }

  newBody += `\n\n---\n`;

  // Clean up the body content
  // Remove any existing View job run, branch links from the bottom
  bodyContent = bodyContent.replace(/\n?\[View job run\]\([^\)]+\)/g, "");
  bodyContent = bodyContent.replace(/\n?\[View branch\]\([^\)]+\)/g, "");

  // Remove any existing duration info at the bottom
  bodyContent = bodyContent.replace(/\n*---\n*Duration: [0-9]+m? [0-9]+s/g, "");

  // Add the cleaned body content
  newBody += bodyContent;

  return newBody.trim();
}
