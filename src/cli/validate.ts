import { runCommand } from './run';

export async function validateCommand(platform?: string): Promise<void> {
  await runCommand(platform, { upload: false });
}
