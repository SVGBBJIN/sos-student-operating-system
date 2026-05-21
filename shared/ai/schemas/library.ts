// Zod schemas for persisted library objects (flashcard decks, study plans).

import { z } from "zod";

export const FlashcardSchema = z.object({
  q: z.string().min(1).max(500),
  a: z.string().min(1).max(2000),
});
export type Flashcard = z.infer<typeof FlashcardSchema>;

export const FlashcardDeckSchema = z.object({
  id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).optional(),
  cards: z.array(FlashcardSchema).min(1).max(40),
  source: z.enum(["ai", "manual"]),
  card_count: z.number().int().min(0).optional(),
  created_at: z.string().optional(),
});
export type FlashcardDeck = z.infer<typeof FlashcardDeckSchema>;
