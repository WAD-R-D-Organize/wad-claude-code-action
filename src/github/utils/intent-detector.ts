#!/usr/bin/env bun

/**
 * User intent detection for branch reuse decisions
 * Analyzes user comments to determine if they explicitly request a new branch
 */

export type BranchIntentResult = {
  wantsNewBranch: boolean;
  confidence: number;
  matchedPatterns: string[];
  reason: string;
};

// Patterns that indicate user wants a new branch
const NEW_BRANCH_PATTERNS = [
  // English patterns
  {
    pattern: /\b(?:new|fresh|create|start)\s+(?:a\s+)?branch\b/gi,
    confidence: 0.9,
    language: "en",
  },
  {
    pattern: /\bcreate\s+(?:a\s+)?(?:new\s+)?branch\b/gi,
    confidence: 0.9,
    language: "en",
  },
  {
    pattern: /\bstart\s+(?:a\s+)?fresh\b/gi,
    confidence: 0.8,
    language: "en",
  },
  {
    pattern: /\bnew\s+feature\s+branch\b/gi,
    confidence: 0.8,
    language: "en",
  },
  {
    pattern: /\bfresh\s+start\b/gi,
    confidence: 0.7,
    language: "en",
  },
  {
    pattern: /\bdifferent\s+branch\b/gi,
    confidence: 0.7,
    language: "en",
  },
  {
    pattern: /\bseparate\s+branch\b/gi,
    confidence: 0.8,
    language: "en",
  },
  {
    pattern: /\bdon't\s+reuse\b|\bdo\s+not\s+reuse\b/gi,
    confidence: 0.8,
    language: "en",
  },

  // Chinese patterns (Traditional and Simplified)
  {
    pattern: /(?:新|建立|創建|開始).*?(?:分支|分枝)/gi,
    confidence: 0.9,
    language: "zh",
  },
  {
    pattern: /(?:重新|全新).*?(?:開始|分支|分枝)/gi,
    confidence: 0.8,
    language: "zh",
  },
  {
    pattern: /(?:不要|別).*?(?:復用|重用|沿用)/gi,
    confidence: 0.8,
    language: "zh",
  },
  {
    pattern: /(?:新建|新增).*?(?:分支|分枝)/gi,
    confidence: 0.9,
    language: "zh",
  },
  {
    pattern: /(?:另外|另一個|新的).*?(?:分支|分枝)/gi,
    confidence: 0.8,
    language: "zh",
  },

  // Japanese patterns
  {
    pattern: /(?:新しい|新規).*?ブランチ/gi,
    confidence: 0.9,
    language: "ja",
  },
  {
    pattern: /ブランチ.*?(?:作成|作る)/gi,
    confidence: 0.8,
    language: "ja",
  },

  // Spanish patterns
  {
    pattern: /(?:nueva|nuevo|crear).*?rama/gi,
    confidence: 0.8,
    language: "es",
  },
  {
    pattern: /rama.*?(?:nueva|nuevo)/gi,
    confidence: 0.8,
    language: "es",
  },

  // French patterns
  {
    pattern: /(?:nouvelle|nouveau|créer).*?branche/gi,
    confidence: 0.8,
    language: "fr",
  },
  {
    pattern: /branche.*?(?:nouvelle|nouveau)/gi,
    confidence: 0.8,
    language: "fr",
  },
];

// Patterns that indicate user wants to continue with existing branch
const REUSE_BRANCH_PATTERNS = [
  // English patterns
  {
    pattern: /\bcontinue\s+(?:on\s+)?(?:this\s+|the\s+|current\s+)?branch\b/gi,
    confidence: 0.8,
    language: "en",
  },
  {
    pattern: /\buse\s+(?:the\s+)?(?:same|existing|current)\s+branch\b/gi,
    confidence: 0.8,
    language: "en",
  },
  {
    pattern: /\breuse\s+(?:the\s+)?(?:same|existing|current)\s+branch\b/gi,
    confidence: 0.9,
    language: "en",
  },
  {
    pattern: /\bkeep\s+(?:using\s+)?(?:this\s+|the\s+|current\s+)?branch\b/gi,
    confidence: 0.8,
    language: "en",
  },
  {
    pattern: /\bstay\s+on\s+(?:this\s+|the\s+|current\s+)?branch\b/gi,
    confidence: 0.8,
    language: "en",
  },

  // Chinese patterns
  {
    pattern: /(?:繼續|继续|沿用|使用|保持).*?(?:這個|这个|當前|当前|現有|现有|同一個|同一个).*?(?:分支|分枝)/gi,
    confidence: 0.8,
    language: "zh",
  },
  {
    pattern: /(?:復用|重用|reuse).*?(?:分支|分枝)/gi,
    confidence: 0.9,
    language: "zh",
  },
  {
    pattern: /(?:不用|不要).*?(?:新建|新增|創建|创建).*?(?:分支|分枝)/gi,
    confidence: 0.8,
    language: "zh",
  },
];

// Context keywords that might modify intent (reduce confidence)
const CONTEXT_MODIFIERS = [
  // Conditional/hypothetical language
  {
    pattern: /\b(?:if|maybe|perhaps|could|would|should|might)\b/gi,
    modifier: -0.2,
    reason: "Conditional language detected",
  },
  {
    pattern: /\b(?:如果|或許|或许|也許|也许|可能)\b/gi,
    modifier: -0.2,
    reason: "Conditional language detected (Chinese)",
  },
  // Negations
  {
    pattern: /\b(?:don't|do\s+not|won't|will\s+not|can't|cannot)\b/gi,
    modifier: -0.3,
    reason: "Negation detected",
  },
  {
    pattern: /\b(?:不|沒有|没有|無法|无法)\b/gi,
    modifier: -0.3,
    reason: "Negation detected (Chinese)",
  },
  // Questions
  {
    pattern: /\?/g,
    modifier: -0.1,
    reason: "Question mark detected",
  },
];

/**
 * Detect user intent for branch creation from comment text
 */
export function detectBranchIntent(commentText: string): BranchIntentResult {
  if (!commentText || commentText.trim().length === 0) {
    return {
      wantsNewBranch: false,
      confidence: 0,
      matchedPatterns: [],
      reason: "Empty comment",
    };
  }

  const text = commentText.toLowerCase();
  const matchedPatterns: string[] = [];
  let maxConfidence = 0;
  let intentType: "new" | "reuse" | "neutral" = "neutral";

  // Check for new branch patterns
  for (const patternInfo of NEW_BRANCH_PATTERNS) {
    const matches = text.match(patternInfo.pattern);
    if (matches && matches.length > 0) {
      matchedPatterns.push(`${patternInfo.language}: ${patternInfo.pattern.toString()}`);
      if (patternInfo.confidence > maxConfidence) {
        maxConfidence = patternInfo.confidence;
        intentType = "new";
      }
    }
  }

  // Check for reuse patterns (might override new branch intent)
  for (const patternInfo of REUSE_BRANCH_PATTERNS) {
    const matches = text.match(patternInfo.pattern);
    if (matches && matches.length > 0) {
      matchedPatterns.push(`${patternInfo.language}: ${patternInfo.pattern.toString()}`);
      if (patternInfo.confidence > maxConfidence) {
        maxConfidence = patternInfo.confidence;
        intentType = "reuse";
      }
    }
  }

  // Apply context modifiers
  let finalConfidence = maxConfidence;
  const modifierReasons: string[] = [];
  
  for (const modifier of CONTEXT_MODIFIERS) {
    const matches = commentText.match(modifier.pattern);
    if (matches && matches.length > 0) {
      finalConfidence = Math.max(0, finalConfidence + modifier.modifier);
      modifierReasons.push(modifier.reason);
    }
  }

  // Determine final intent
  let wantsNewBranch: boolean;
  let reason: string;

  if (intentType === "new" && finalConfidence > 0.5) {
    wantsNewBranch = true;
    reason = `Explicit request for new branch detected (confidence: ${finalConfidence.toFixed(2)})`;
  } else if (intentType === "reuse" && finalConfidence > 0.5) {
    wantsNewBranch = false;
    reason = `Explicit request to reuse existing branch (confidence: ${finalConfidence.toFixed(2)})`;
  } else if (maxConfidence > 0) {
    wantsNewBranch = intentType === "new";
    reason = `Low confidence intent detected (confidence: ${finalConfidence.toFixed(2)}), defaulting to ${intentType === "new" ? "new branch" : "branch reuse"}`;
  } else {
    wantsNewBranch = false;
    reason = "No explicit branch intent detected";
  }

  if (modifierReasons.length > 0) {
    reason += `. Context modifiers: ${modifierReasons.join(", ")}`;
  }

  return {
    wantsNewBranch,
    confidence: finalConfidence,
    matchedPatterns,
    reason,
  };
}

/**
 * Analyze multiple comments to determine overall branch intent
 * Gives more weight to recent comments
 */
export function detectBranchIntentFromComments(
  comments: Array<{ body: string; createdAt: string; author?: { login: string } }>,
  triggerUsername?: string
): BranchIntentResult {
  if (!comments || comments.length === 0) {
    return {
      wantsNewBranch: false,
      confidence: 0,
      matchedPatterns: [],
      reason: "No comments provided",
    };
  }

  // Sort comments by creation time (most recent first)
  const sortedComments = [...comments].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  let bestResult: BranchIntentResult = {
    wantsNewBranch: false,
    confidence: 0,
    matchedPatterns: [],
    reason: "No intent detected",
  };

  // Analyze comments, giving more weight to recent ones and trigger user's comments
  for (let i = 0; i < Math.min(sortedComments.length, 10); i++) {
    const comment = sortedComments[i];
    const result = detectBranchIntent(comment.body);

    if (result.confidence > 0) {
      // Apply recency weight (more recent = higher weight)
      const recencyWeight = Math.max(0.5, 1 - i * 0.1);
      
      // Apply author weight (trigger user = higher weight)
      const authorWeight = comment.author?.login === triggerUsername ? 1.2 : 1.0;
      
      const weightedConfidence = result.confidence * recencyWeight * authorWeight;

      if (weightedConfidence > bestResult.confidence) {
        bestResult = {
          ...result,
          confidence: weightedConfidence,
          reason: `${result.reason} (from comment #${i + 1}, recency weight: ${recencyWeight.toFixed(2)}, author weight: ${authorWeight.toFixed(2)})`,
        };
      }
    }
  }

  return bestResult;
}

/**
 * Get recommended branch strategy based on intent and configuration
 */
export function getRecommendedBranchStrategy(
  intentResult: BranchIntentResult,
  configuredStrategy: "always_new" | "smart_reuse" | "always_reuse"
): {
  shouldCreateNew: boolean;
  reason: string;
} {
  switch (configuredStrategy) {
    case "always_new":
      return {
        shouldCreateNew: true,
        reason: "Configuration set to always create new branches",
      };

    case "always_reuse":
      return {
        shouldCreateNew: false,
        reason: "Configuration set to always reuse existing branches",
      };

    case "smart_reuse":
      if (intentResult.confidence > 0.6 && intentResult.wantsNewBranch) {
        return {
          shouldCreateNew: true,
          reason: `User explicitly requested new branch: ${intentResult.reason}`,
        };
      } else if (intentResult.confidence > 0.6 && !intentResult.wantsNewBranch) {
        return {
          shouldCreateNew: false,
          reason: `User explicitly requested branch reuse: ${intentResult.reason}`,
        };
      } else {
        return {
          shouldCreateNew: false,
          reason: `No clear intent detected (${intentResult.reason}), defaulting to branch reuse`,
        };
      }

    default:
      return {
        shouldCreateNew: false,
        reason: "Unknown configuration, defaulting to branch reuse",
      };
  }
}