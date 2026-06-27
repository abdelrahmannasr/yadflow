export type Level = 'beginner' | 'intermediate' | 'advanced';

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'steps'; items: string[] }
  | { kind: 'callout'; tone: 'info' | 'warn' | 'key'; text: string };

export interface CommandLine {
  cmd: string;
  note?: string;
}

export interface QuizQuestion {
  q: string;
  options: string[];
  answer: number;
  explain: string;
}

export interface Lesson {
  id: string;
  title: string;
  duration: string;
  level: Level;
  summary: string;
  body: Block[];
  /** Commands the learner runs in this lesson. */
  commands?: CommandLine[];
  /** Files/state this step produces. */
  produces?: string[];
  /** End-of-lesson comprehension check. */
  quiz?: QuizQuestion[];
}

export interface Module {
  id: string;
  number: number;
  title: string;
  blurb: string;
  icon: string; // Material Symbols name
  level: Level;
  lessons: Lesson[];
}
