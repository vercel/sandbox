import { Sandbox } from '@vercel/sandbox';
import { generateText } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import * as fs from 'fs';

async function main() {
  const prompt = `Generate Python code to create a chart visualizing the average weather temperatures across the year in Berlin. 

Requirements:
- Use matplotlib for visualization
- Create realistic monthly temperature data for Berlin (cold winters, mild summers)
- Save the chart as 'berlin_weather.png'
- Include proper labels, title, and styling
- Make it visually appealing with colors and grid

IMPORTANT: Return ONLY the raw Python code. Do NOT use markdown code blocks, backticks, or any formatting. Start directly with 'import' statements.`;

  console.log('Generating chart code with AI Gateway...');
  const response = await generateText({
    model: gateway('openai/gpt-4o'),
    prompt: prompt,
    temperature: 0.7,
  });

  console.log('Creating sandbox...');
  const sandbox = await Sandbox.create({
    runtime: 'python3.13',
    timeout: 300000,
  });

  console.log('Installing Python packages with uv...');
  await sandbox.runCommand({
    cmd: 'uv',
    args: ['pip', 'install', '--system', 'matplotlib', 'pandas', 'numpy'],
    sudo: true,
  });


  // Write the Python code to the sandbox
  console.log('Writing and executing Python code...');
  await sandbox.writeFiles([
    {
      path: 'generate_chart.py',
      content: Buffer.from(response.text),
    },
  ]);

  // Run the Python code
  const result = await sandbox.runCommand('python', ['generate_chart.py']);
  
  if (result.exitCode === 0) {
    console.log('Chart generated successfully!');

    // Read the generated image from the sandbox
    const imageStream = await sandbox.readFile({ path: 'berlin_weather.png' });
    
    if (imageStream) {
      const writeStream = fs.createWriteStream('berlin_weather.png');
      imageStream.pipe(writeStream);
      
      await new Promise((resolve, reject) => {
        writeStream.on('finish', () => {
          console.log('Image saved as berlin_weather.png');
          resolve(undefined);
        });
        writeStream.on('error', reject);
        imageStream.on('error', reject);
      });
    }
  } else {
    console.log('Failed to generate chart');
    console.log('Error:', await result.stderr());
  }

  await sandbox.stop();
}

main().catch(console.error); 
