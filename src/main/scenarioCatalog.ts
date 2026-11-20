import type { Difficulty, VulnerabilityTopic } from '../shared/ipcTypes';
import type { SecGenScenarioContext } from '../shared/types';

export interface CatalogEntry {
  context: SecGenScenarioContext;
  title: string;
  difficulty: Difficulty;
  topic: VulnerabilityTopic;
  briefing: string;
  /** File name of the SecGen scenario XML inside the scenarios directory. */
  scenarioFile: string;
  /** Host port the target web service is forwarded to on 127.0.0.1. */
  hostPort: number;
}

function entry(
  id: string,
  title: string,
  difficulty: Difficulty,
  topic: VulnerabilityTopic,
  briefing: string,
  hostPort: number,
): CatalogEntry {
  return {
    title,
    difficulty,
    topic,
    briefing,
    hostPort,
    scenarioFile: `${id}.xml`,
    context: { id, name: title, description: briefing, vulnerabilities: [topic], services: ['HTTP'] },
  };
}

export const SCENARIO_CATALOG: CatalogEntry[] = [
  {
    ...entry('demo-sqli-01', 'Demo: SQL Injection', 'Beginner', 'SQL injection',
      'Explore a vulnerable storefront login and recover the demo flag.', 0),
    context: {
      id: 'demo-sqli-01',
      name: 'Demo: SQL Injection',
      description: 'A storefront login concatenates user input into a SQL query.',
      vulnerabilities: ['SQL injection'],
      services: ['HTTP', 'SQLite'],
      hints: ['Consider how a quote changes a SQL string literal.', 'Inspect SQL errors and think about how Boolean conditions affect authentication.'],
    },
  },
  entry('sqli-login-bypass', 'Login Bypass', 'Beginner', 'SQL injection',
    'A storefront login form builds its query from raw input. Find out how to get past authentication and recover the flag.', 18081),
  entry('idor-order-viewer', 'Order Viewer', 'Beginner', 'IDOR',
    'Customers can view their own orders by ID. Investigate whether you can read someone else\'s order.', 18082),
  entry('xss-guestbook', 'Guestbook', 'Intermediate', 'Cross-site scripting',
    'A guestbook echoes visitor messages back to every reader. Work out how untrusted input is rendered.', 18083),
  entry('bac-admin-panel', 'Hidden Admin Panel', 'Intermediate', 'Broken access control',
    'An admin panel is only hidden, not protected. Discover how access decisions are made.', 18084),
  entry('cmdi-ping-tool', 'Network Ping Tool', 'Advanced', 'OS command injection',
    'A diagnostics page shells out to run ping. Examine how user input reaches the command line.', 18085),
];
