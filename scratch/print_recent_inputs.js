const fs = require('fs');
const readline = require('readline');

async function main() {
  const filePath = '/Users/manelcheraiti/.gemini/antigravity/brain/b86e0e24-5992-4a0a-b529-b3f128181eec/.system_generated/logs/transcript.jsonl';
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const inputs = [];
  for await (const line of rl) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'USER_INPUT') {
        inputs.push({
          step: obj.step_index,
          created_at: obj.created_at,
          content: obj.content.replace(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/, '$1').trim()
        });
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  console.log("LAST 15 USER INPUTS:");
  inputs.slice(-15).forEach(inp => {
    console.log(`[Step ${inp.step} - ${inp.created_at}]: ${inp.content.substring(0, 300)}`);
    console.log("-".repeat(40));
  });
}

main().catch(console.error);
