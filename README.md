# SOS — Student Operating System

A single-file AI-powered student assistant web application that helps students manage tasks, schedules, notes, and more. Built with React and integrated with Supabase for backend services and Groq for AI chat capabilities.

## Features

- 🤖 AI-powered chat assistant
- 📝 Task and schedule management
- 📅 Google Calendar integration
- 📄 Document and PDF import
- 🎯 Focus mode with Pomodoro timer
- ☁️ Weather integration
- 💾 Cloud sync via Supabase

## Quick Start

### Option 1: Open Directly in Browser
Simply open `index.html` in any modern web browser (Chrome, Firefox, Safari, Edge).

### Option 2: Using a Local Server
For best results, serve the file using a local HTTP server:

```bash
# Using Python 3
python3 -m http.server 8080

# Using Python 2
python -m SimpleHTTPServer 8080

# Using Node.js (http-server)
npx http-server -p 8080

# Using PHP
php -S localhost:8080
```

Then navigate to `http://localhost:8080/index.html` in your browser.

### Option 3: Deploy to GitHub Pages
1. Enable GitHub Pages in your repository settings
2. Select the branch containing `index.html`
3. Set the root directory as the source
4. Access your app at `https://[username].github.io/[repository-name]/`

## Configuration

The application uses Supabase for backend services and requires no additional configuration. The necessary API keys are already embedded in the file.

### Google Calendar Integration
To use Google Calendar features:
1. Click the settings icon in the app
2. Connect your Google account
3. Grant calendar access permissions

## Technology Stack

- **Frontend**: React 18.2.0 (via CDN)
- **Backend**: Supabase
- **AI**: Groq LLaMA
- **Styling**: Pure CSS (no framework)
- **Build**: Babel Standalone (JSX transpilation in-browser)

## File Structure

This is a single-file application. All code, styles, and logic are contained in `index.html`:
- HTML structure
- CSS styling
- React components
- Application logic
- External dependencies loaded via CDN

## Browser Compatibility

Works best in modern browsers with ES6+ support:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Development

To modify the application, simply edit `index.html`. The React JSX code is transpiled in-browser using Babel Standalone, so no build step is required.

### Key Sections in index.html:
- Lines 1-195: HTML head with dependencies and styles
- Lines 196-197: Body with root div
- Lines 198-2343: React application code (JSX)

## Security Note

This application includes API keys for demonstration purposes. For production use, consider:
1. Moving sensitive keys to environment variables
2. Implementing proper authentication
3. Using Supabase Row Level Security (RLS)

## License

[Your License Here]

## Support

For issues or questions, please open an issue on GitHub.