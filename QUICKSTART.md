# Quick Start Guide

## Getting Started with SOS

Welcome to SOS (Student Operating System)! This guide will help you get up and running in minutes.

## Step 1: Open the Application

### Desktop/Laptop
Double-click `index.html` to open it in your default browser.

### Recommended: Use a Local Server
For the best experience, run a local server:

```bash
python3 -m http.server 8080
```

Then visit: `http://localhost:8080/index.html`

## Step 2: First Use

When you first open SOS, you'll see:
- A chat interface powered by AI
- The main input area at the bottom
- Quick action chips for common tasks

### Try These Commands:
- "Add a task to study for math exam tomorrow"
- "Show my schedule for today"
- "Set a 25-minute focus timer"
- "What's the weather?"

## Step 3: Connect Your Calendar (Optional)

1. Click the settings icon (⚙️) in the top right
2. Click "Connect Google"
3. Sign in with your Google account
4. Grant calendar permissions

Now you can:
- Import events from Google Calendar
- Sync your schedule
- Import Google Docs

## Step 4: Use Focus Mode

Press `F` or say "start focus mode" to enter a distraction-free study environment with:
- Pomodoro timer (25 min work / 5 min break)
- Current task display
- Minimal interface

## Keyboard Shortcuts

- `/` - Focus on input field
- `S` - Open schedule peek
- `F` - Toggle focus mode
- `Enter` - Send message
- `Esc` - Close modals

## Tips for Best Results

### Task Management
- Be specific: "Add task: Complete Chapter 5 homework by Friday 5 PM"
- Break down large tasks: "Break this task into smaller parts"
- Set priorities: Include words like "urgent" or "important"

### Schedule Management
- Use natural language: "Block 2-4 PM tomorrow for studying"
- Add context: "Add event: Team meeting on Tuesday at 3 PM"

### AI Chat
- Ask questions about your schedule
- Request study tips
- Get task suggestions
- Ask for time management advice

## Troubleshooting

### App Won't Load
- Ensure you have internet connection (required for CDN resources)
- Try using a local server instead of opening directly
- Check browser console (F12) for errors
- Use a modern browser (Chrome, Firefox, Safari, Edge)

### Features Not Working
- Check that JavaScript is enabled
- Ensure pop-ups are allowed (for Google OAuth)
- Clear browser cache and reload

### Data Not Saving
- The app uses Supabase for cloud storage
- Check your internet connection
- Data is saved automatically after each action

## Privacy & Data

- Your data is stored securely in Supabase
- Calendar data is only imported with your permission
- API keys are embedded for demo purposes
- No data is sold or shared with third parties

## Next Steps

- Explore the chat interface
- Try different commands
- Connect your Google Calendar
- Set up your first study session
- Create a weekly schedule

## Need Help?

- Check the [README.md](README.md) for detailed documentation
- See [DEPLOYMENT.md](DEPLOYMENT.md) for hosting options
- Open an issue on GitHub for bugs or feature requests

Happy studying! 🎓
