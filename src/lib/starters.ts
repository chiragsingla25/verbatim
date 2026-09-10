// Starter questions shown on the Ask empty state — a nudge past the blank composer.
// Authored per instrument (keyed by instrument slug); GENERIC covers anything else.
// Clicking one prefills the composer; it is never auto-submitted.

const GENERIC = [
  'What is this instrument used for?',
  'How is it scored?',
  'What are the cut-off scores and severity bands?',
  'How many items does it have, and what is the score range?',
  'How many pages is this manual, and when was it published?',
]

export const STARTERS: Record<string, string[]> = {
  pss: [
    'Which items of the PSS are reverse-scored?',
    'What are the response option labels?',
    'What is the mean PSS score for women in the norm table?',
    'How long does the predictive validity of the PSS hold?',
    'How many items are in the short form of the PSS?',
  ],
  'phq-gad7': [
    'What PHQ-9 total score indicates moderately severe depression?',
    'What are the GAD-7 cut-points for mild, moderate, and severe anxiety?',
    'What is the score range of the PHQ-9?',
    'What is the recommended action for a PHQ-9 score of 20 to 27?',
    'How is the PHQ-2 scored, and what is its purpose?',
  ],
  audit: [
    'What total AUDIT score indicates hazardous or harmful drinking?',
    'What are the AUDIT risk zones, and what action does each imply?',
    'What is the lower cut-off recommended for older adults?',
    'How many questions are on the AUDIT, and how is the total calculated?',
    'What does a score in Zone II mean?',
  ],
}

export function startersFor(slug: string | null | undefined): string[] {
  return (slug && STARTERS[slug]) || GENERIC
}
