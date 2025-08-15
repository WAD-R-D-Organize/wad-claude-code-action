#!/usr/bin/env node
// GitHub Issue Metadata MCP Server - Manages issue labels and types
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GITHUB_API_URL } from "../github/api/config";
import { Octokit } from "@octokit/rest";

// Get environment variables
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const ENABLE_TYPES = process.env.ENABLE_TYPES === "true";

if (!REPO_OWNER || !REPO_NAME) {
  console.error(
    "Error: REPO_OWNER and REPO_NAME environment variables are required",
  );
  process.exit(1);
}

const server = new McpServer({
  name: "GitHub Issue Metadata Server",
  version: "0.0.1",
});

// Initialize Octokit
function getOctokit() {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN environment variable is required");
  }

  return new Octokit({
    auth: githubToken,
    baseUrl: GITHUB_API_URL,
  });
}

// Tool: Get repository labels
server.tool(
  "get_repository_labels",
  "Get all available labels in the repository",
  {},
  async () => {
    try {
      const octokit = getOctokit();

      const { data: labels } = await octokit.issues.listLabelsForRepo({
        owner: REPO_OWNER!,
        repo: REPO_NAME!,
        per_page: 100,
      });

      const labelInfo = labels.map((label) => ({
        name: label.name,
        description: label.description || "",
        color: label.color,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ labels: labelInfo }, null, 2),
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
            text: `Error fetching repository labels: ${errorMessage}`,
          },
        ],
        error: errorMessage,
        isError: true,
      };
    }
  },
);

// Tool: Get issue labels
server.tool(
  "get_issue_labels",
  "Get current labels for a specific issue",
  {
    issue_number: z
      .number()
      .optional()
      .describe("Issue number (defaults to current issue)"),
  },
  async ({ issue_number }) => {
    try {
      const octokit = getOctokit();
      const issueNum = issue_number || parseInt(ISSUE_NUMBER || "0", 10);

      if (!issueNum) {
        throw new Error("Issue number is required");
      }

      const { data: issue } = await octokit.issues.get({
        owner: REPO_OWNER!,
        repo: REPO_NAME!,
        issue_number: issueNum,
      });

      const labels = issue.labels.map((label) =>
        typeof label === "string" ? label : label.name,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                issue_number: issueNum,
                labels: labels,
              },
              null,
              2,
            ),
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
            text: `Error fetching issue labels: ${errorMessage}`,
          },
        ],
        error: errorMessage,
        isError: true,
      };
    }
  },
);

// Tool: Update issue labels
server.tool(
  "update_issue_labels",
  "Update labels for an issue (add or remove labels)",
  {
    labels: z
      .array(z.string())
      .describe("Array of label names to set (replaces all existing labels)"),
    issue_number: z
      .number()
      .optional()
      .describe("Issue number (defaults to current issue)"),
    add_labels: z
      .array(z.string())
      .optional()
      .describe("Labels to add (alternative to replacing all)"),
    remove_labels: z
      .array(z.string())
      .optional()
      .describe("Labels to remove (alternative to replacing all)"),
  },
  async ({ labels, issue_number, add_labels, remove_labels }) => {
    try {
      const octokit = getOctokit();
      const issueNum = issue_number || parseInt(ISSUE_NUMBER || "0", 10);

      if (!issueNum) {
        throw new Error("Issue number is required");
      }

      let result;

      if (labels) {
        // Replace all labels
        result = await octokit.issues.setLabels({
          owner: REPO_OWNER!,
          repo: REPO_NAME!,
          issue_number: issueNum,
          labels: labels,
        });
      } else {
        // Add/remove specific labels
        if (add_labels && add_labels.length > 0) {
          await octokit.issues.addLabels({
            owner: REPO_OWNER!,
            repo: REPO_NAME!,
            issue_number: issueNum,
            labels: add_labels,
          });
        }

        if (remove_labels && remove_labels.length > 0) {
          for (const label of remove_labels) {
            try {
              await octokit.issues.removeLabel({
                owner: REPO_OWNER!,
                repo: REPO_NAME!,
                issue_number: issueNum,
                name: label,
              });
            } catch (error: any) {
              // Ignore 404 errors (label not found)
              if (error.status !== 404) {
                throw error;
              }
            }
          }
        }

        // Get updated labels
        const { data: issue } = await octokit.issues.get({
          owner: REPO_OWNER!,
          repo: REPO_NAME!,
          issue_number: issueNum,
        });
        result = { data: issue.labels };
      }

      const updatedLabels = result.data.map((label) =>
        typeof label === "string" ? label : label.name,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                issue_number: issueNum,
                updated_labels: updatedLabels,
                operation: labels ? "replaced" : "modified",
              },
              null,
              2,
            ),
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
            text: `Error updating issue labels: ${errorMessage}`,
          },
        ],
        error: errorMessage,
        isError: true,
      };
    }
  },
);

// Issue Types tools (only if enabled)
if (ENABLE_TYPES) {
  // Tool: Get organization issue types
  server.tool(
    "get_organization_issue_types",
    "Get all available issue types for the organization",
    {},
    async () => {
      try {
        const octokit = getOctokit();

        // Use GraphQL to get issue types
        const query = `
          query GetOrganizationIssueTypes($owner: String!) {
            organization(login: $owner) {
              issueTypes(first: 100) {
                nodes {
                  id
                  name
                  description
                }
              }
            }
          }
        `;

        const response = await octokit.graphql({
          query,
          owner: REPO_OWNER!,
          headers: {
            "GraphQL-Features": "issue_types",
          },
        });

        const data = response as any;
        const issueTypes = data.organization?.issueTypes?.nodes || [];

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ issue_types: issueTypes }, null, 2),
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
              text: `Error fetching organization issue types: ${errorMessage}`,
            },
          ],
          error: errorMessage,
          isError: true,
        };
      }
    },
  );

  // Tool: Get issue type
  server.tool(
    "get_issue_type",
    "Get the current type for a specific issue",
    {
      issue_number: z
        .number()
        .optional()
        .describe("Issue number (defaults to current issue)"),
    },
    async ({ issue_number }) => {
      try {
        const octokit = getOctokit();
        const issueNum = issue_number || parseInt(ISSUE_NUMBER || "0", 10);

        if (!issueNum) {
          throw new Error("Issue number is required");
        }

        // Use GraphQL to get issue type
        const query = `
          query GetIssueType($owner: String!, $repo: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) {
              issue(number: $number) {
                issueType {
                  id
                  name
                  description
                }
              }
            }
          }
        `;

        const response = await octokit.graphql({
          query,
          owner: REPO_OWNER!,
          repo: REPO_NAME!,
          number: issueNum,
          headers: {
            "GraphQL-Features": "issue_types",
          },
        });

        const data = response as any;
        const issueType = data.repository?.issue?.issueType;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  issue_number: issueNum,
                  issue_type: issueType,
                },
                null,
                2,
              ),
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
              text: `Error fetching issue type: ${errorMessage}`,
            },
          ],
          error: errorMessage,
          isError: true,
        };
      }
    },
  );

  // Tool: Update issue type
  server.tool(
    "update_issue_type",
    "Update the type for an issue",
    {
      type_id: z.string().describe("Issue type ID to set"),
      issue_number: z
        .number()
        .optional()
        .describe("Issue number (defaults to current issue)"),
    },
    async ({ type_id, issue_number }) => {
      try {
        const octokit = getOctokit();
        const issueNum = issue_number || parseInt(ISSUE_NUMBER || "0", 10);

        if (!issueNum) {
          throw new Error("Issue number is required");
        }

        // First get the issue's global ID
        const issueQuery = `
          query GetIssueId($owner: String!, $repo: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) {
              issue(number: $number) {
                id
              }
            }
          }
        `;

        const issueResponse = await octokit.graphql(issueQuery, {
          owner: REPO_OWNER!,
          repo: REPO_NAME!,
          number: issueNum,
        });

        const issueData = issueResponse as any;
        const issueId = issueData.repository?.issue?.id;

        if (!issueId) {
          throw new Error("Could not find issue");
        }

        // Update issue type using mutation
        const mutation = `
          mutation UpdateIssueType($issueId: ID!, $typeId: ID!) {
            updateIssue(input: {id: $issueId, issueTypeId: $typeId}) {
              issue {
                number
                issueType {
                  id
                  name
                  description
                }
              }
            }
          }
        `;

        const response = await octokit.graphql({
          query: mutation,
          issueId: issueId,
          typeId: type_id,
          headers: {
            "GraphQL-Features": "issue_types",
          },
        });

        const data = response as any;
        const updatedIssue = data.updateIssue?.issue;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  issue_number: issueNum,
                  updated_type: updatedIssue?.issueType,
                },
                null,
                2,
              ),
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
              text: `Error updating issue type: ${errorMessage}`,
            },
          ],
          error: errorMessage,
          isError: true,
        };
      }
    },
  );
}

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on("exit", () => {
    server.close();
  });
}

runServer().catch(console.error);
