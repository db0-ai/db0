import type { BenchmarkDataset } from "../types.js";

/**
 * Simple Recall Benchmark — tests basic store-and-retrieve accuracy.
 *
 * Simple A/B smoke test. Tests whether the memory system
 * can store facts from conversations and retrieve them accurately.
 *
 * Categories:
 * - single-hop: direct fact recall ("What is the project codename?")
 * - temporal: time-sensitive facts ("When was the last deployment?")
 * - multi-hop: connecting two facts ("Who manages the team that owns login?")
 * - unanswerable: fact was never mentioned
 */
export function createRecallDataset(): BenchmarkDataset {
  return {
    name: "simple-recall",
    description: "Basic store-and-retrieve accuracy across 4 query types",
    sessions: [
      {
        id: "session-1",
        turns: [
          { role: "user", turnIndex: 0, content: "Remember that the project codename is Aurora Finch." },
          { role: "assistant", turnIndex: 1, content: "Got it — project codename is Aurora Finch." },
          { role: "user", turnIndex: 2, content: "We deploy to us-west-2 every Thursday at 3pm UTC." },
          { role: "assistant", turnIndex: 3, content: "Noted — us-west-2 deployment window is Thursdays at 3pm UTC." },
          { role: "user", turnIndex: 4, content: "The staging environment uses the eu-central-1 region." },
          { role: "assistant", turnIndex: 5, content: "Staging is in eu-central-1, understood." },
          { role: "user", turnIndex: 6, content: "Alice manages the authentication team." },
          { role: "assistant", turnIndex: 7, content: "Noted — Alice manages the auth team." },
          { role: "user", turnIndex: 8, content: "The auth team owns the login service and the SSO gateway." },
          { role: "assistant", turnIndex: 9, content: "Auth team owns login service and SSO gateway." },
          { role: "user", turnIndex: 10, content: "We switched from REST to GraphQL in Q4 2025." },
          { role: "assistant", turnIndex: 11, content: "API migration to GraphQL happened in Q4 2025." },
          { role: "user", turnIndex: 12, content: "The maximum retry count for failed jobs is 5." },
          { role: "assistant", turnIndex: 13, content: "Max retry count is 5 for failed jobs." },
          { role: "user", turnIndex: 14, content: "Our CI pipeline uses GitHub Actions with self-hosted runners." },
          { role: "assistant", turnIndex: 15, content: "CI: GitHub Actions with self-hosted runners." },
        ],
      },
      {
        id: "session-2",
        turns: [
          { role: "user", turnIndex: 0, content: "Bob joined the platform team last month. He's focused on the billing service." },
          { role: "assistant", turnIndex: 1, content: "Bob is on the platform team, working on billing." },
          { role: "user", turnIndex: 2, content: "The billing service uses Stripe for payment processing." },
          { role: "assistant", turnIndex: 3, content: "Stripe is our payment processor for billing." },
          { role: "user", turnIndex: 4, content: "We need to migrate from PostgreSQL 14 to 16 by end of March." },
          { role: "assistant", turnIndex: 5, content: "Postgres 14 → 16 migration deadline is end of March." },
          { role: "user", turnIndex: 6, content: "The mobile app uses React Native. The web frontend uses Next.js." },
          { role: "assistant", turnIndex: 7, content: "Mobile: React Native. Web: Next.js." },
        ],
      },
    ],
    queries: [
      // Single-hop: direct fact recall
      {
        id: "recall-1",
        query: "What is the project codename?",
        expectedAnswer: "Aurora Finch",
        category: "single-hop",
      },
      {
        id: "recall-2",
        query: "Which AWS region do we deploy to?",
        expectedAnswer: "us-west-2",
        category: "single-hop",
      },
      {
        id: "recall-3",
        query: "What region is staging in?",
        expectedAnswer: "eu-central-1",
        category: "single-hop",
      },
      {
        id: "recall-4",
        query: "What is the max retry count for failed jobs?",
        expectedAnswer: "5",
        category: "single-hop",
      },
      {
        id: "recall-5",
        query: "What CI system do we use?",
        expectedAnswer: "GitHub Actions with self-hosted runners",
        category: "single-hop",
      },
      {
        id: "recall-6",
        query: "What payment processor does billing use?",
        expectedAnswer: "Stripe",
        category: "single-hop",
      },
      {
        id: "recall-7",
        query: "What framework does the mobile app use?",
        expectedAnswer: "React Native",
        category: "single-hop",
      },

      // Temporal: time-sensitive facts
      {
        id: "temporal-1",
        query: "When do we deploy to production?",
        expectedAnswer: "Thursday at 3pm UTC",
        category: "temporal",
      },
      {
        id: "temporal-2",
        query: "When did we switch to GraphQL?",
        expectedAnswer: "Q4 2025",
        category: "temporal",
      },
      {
        id: "temporal-3",
        query: "When is the PostgreSQL migration deadline?",
        expectedAnswer: "end of March",
        category: "temporal",
      },

      // Multi-hop: requires connecting facts
      {
        id: "multi-1",
        query: "Who manages the team that owns the login service?",
        expectedAnswer: "Alice",
        category: "multi-hop",
      },
      {
        id: "multi-2",
        query: "What is Bob working on and what external service does it use?",
        expectedAnswer: "billing service | Stripe",
        category: "multi-hop",
      },
      {
        id: "multi-3",
        query: "Who should I talk to about SSO issues?",
        expectedAnswer: "Alice",
        category: "multi-hop",
      },

      // Unanswerable: never mentioned
      {
        id: "unans-1",
        query: "What database does the logging service use?",
        expectedAnswer: "",
        category: "unanswerable",
      },
      {
        id: "unans-2",
        query: "Who is the CTO?",
        expectedAnswer: "",
        category: "unanswerable",
      },
    ],
  };
}
