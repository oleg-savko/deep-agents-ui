"use client";

import React, { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendFeedback } from "@/lib/langfuse";
import { cn } from "@/lib/utils";

interface FeedbackButtonsProps {
  traceId: string;
  className?: string;
}

export function FeedbackButtons({ traceId, className }: FeedbackButtonsProps) {
  const [feedback, setFeedback] = useState<"positive" | "negative" | null>(null);
  const [comment, setComment] = useState("");
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [customScore, setCustomScore] = useState<string>("");

  const handleFeedback = (value: "positive" | "negative") => {
    // If clicking the same button, toggle it off
    if (feedback === value) {
      setFeedback(null);
      setShowCommentInput(false);
      setComment("");
      setCustomScore("");
      return;
    }

    setFeedback(value);
    setShowCommentInput(true);
  };

  const handleCommentSubmit = () => {
    if (feedback === null) return;

    // Use custom score if provided, otherwise use binary feedback
    let feedbackValue: number;
    if (customScore.trim() !== "") {
      const parsedScore = parseFloat(customScore);
      if (isNaN(parsedScore)) {
        alert("Please enter a valid number for the score");
        return;
      }
      if (parsedScore < 0 || parsedScore > 1) {
        alert("Score must be between 0 and 1");
        return;
      }
      feedbackValue = parsedScore;
    } else {
      feedbackValue = feedback === "positive" ? 1 : 0;
    }

    sendFeedback({
      traceId,
      value: feedbackValue,
      comment: comment.trim() || undefined,
    });

    setShowCommentInput(false);
    setComment("");
    setCustomScore("");
  };

  const handleCommentCancel = () => {
    setShowCommentInput(false);
    setComment("");
    setCustomScore("");
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => handleFeedback("positive")}
          className={cn(
            "h-8 w-8 p-0",
            feedback === "positive" && "bg-green-100 text-green-700 hover:bg-green-200"
          )}
          aria-label="Thumbs up"
        >
          <ThumbsUp size={16} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => handleFeedback("negative")}
          className={cn(
            "h-8 w-8 p-0",
            feedback === "negative" && "bg-red-100 text-red-700 hover:bg-red-200"
          )}
          aria-label="Thumbs down"
        >
          <ThumbsDown size={16} />
        </Button>
      </div>
      {showCommentInput && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/50 p-3 shadow-sm backdrop-blur-sm">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-foreground">
              Custom Score (optional)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={customScore}
              onChange={(e) => setCustomScore(e.target.value)}
              placeholder={`Default: ${feedback === "positive" ? "1.0" : "0.0"} (range: 0.0 - 1.0)`}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-foreground">
              Comment (optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add your feedback..."
              className="min-h-[60px] w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleCommentSubmit();
                } else if (e.key === "Escape") {
                  handleCommentCancel();
                }
              }}
              autoFocus
              rows={2}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Press {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter to submit
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCommentCancel}
                className="h-8 px-3 text-xs"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleCommentSubmit}
                className="h-8 px-3 text-xs"
              >
                Submit
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
