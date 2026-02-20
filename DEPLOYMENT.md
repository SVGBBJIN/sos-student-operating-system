# Deployment Guide

## GitHub Pages Deployment

### Method 1: Using Repository Settings (Easiest)

1. Go to your repository on GitHub
2. Click on **Settings** → **Pages**
3. Under "Source", select the branch containing `index.html` (usually `main` or `master`)
4. Select `/` (root) as the folder
5. Click **Save**
6. Wait a few minutes for deployment
7. Your site will be available at: `https://[username].github.io/[repository-name]/`

### Method 2: Using Custom Domain

1. Follow Method 1 above
2. In the Pages settings, add your custom domain
3. Configure your domain's DNS settings to point to GitHub Pages
4. Enable HTTPS (recommended)

## Alternative Hosting Options

### Netlify
1. Create a free account at [Netlify](https://www.netlify.com/)
2. Drag and drop your repository folder
3. Your site is live instantly!

### Vercel
1. Create a free account at [Vercel](https://vercel.com/)
2. Import your GitHub repository
3. Vercel will auto-deploy

### Cloudflare Pages
1. Create a free account at [Cloudflare Pages](https://pages.cloudflare.com/)
2. Connect your GitHub repository
3. Set build command to: (none, it's a static file)
4. Set output directory to: `/`

## Local Testing

Before deploying, test locally:

```bash
# Using Python
python3 -m http.server 8080

# Then visit: http://localhost:8080/index.html
```

## Troubleshooting

### External Resources Not Loading
- Ensure you're serving over HTTPS in production
- Check browser console for CORS errors
- Verify internet connection (CDN resources required)

### App Not Rendering
- Check that JavaScript is enabled in browser
- Open browser console (F12) to check for errors
- Ensure modern browser (Chrome 90+, Firefox 88+, Safari 14+)

### Supabase Connection Issues
- Verify the API keys in index.html are valid
- Check Supabase project status at dashboard.supabase.com
- Ensure your Supabase project is not paused (free tier limitation)
