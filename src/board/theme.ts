import chalk from "chalk";

export interface Theme {
  text: {
    primary: (s: string) => string;
    secondary: (s: string) => string;
    muted: (s: string) => string;
    success: (s: string) => string;
    warning: (s: string) => string;
    error: (s: string) => string;
    accent: (s: string) => string;
  };
  border: {
    primary: (s: string) => string;
    muted: (s: string) => string;
    focus: (s: string) => string;
  };
  priority: {
    high: (s: string) => string;
    medium: (s: string) => string;
    low: (s: string) => string;
    none: (s: string) => string;
  };
  assignee: {
    self: (s: string) => string;
    others: (s: string) => string;
    unassigned: (s: string) => string;
  };
}

export const darkTheme: Theme = {
  text: {
    primary: chalk.white,
    secondary: chalk.gray,
    muted: chalk.dim,
    success: chalk.green,
    warning: chalk.yellow,
    error: chalk.red,
    accent: chalk.cyan,
  },
  border: {
    primary: chalk.gray,
    muted: chalk.dim,
    focus: chalk.cyan,
  },
  priority: {
    high: chalk.red,
    medium: chalk.yellow,
    low: chalk.blue,
    none: chalk.gray,
  },
  assignee: {
    self: chalk.greenBright,
    others: chalk.white,
    unassigned: chalk.dim,
  },
};

export function getTheme(): Theme {
  return darkTheme;
}
