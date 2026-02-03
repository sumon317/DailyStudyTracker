# 📚 Daily Study Tracker

A beautiful, feature-rich study tracking application built with React. Track your daily study progress, set goals, and stay motivated with stunning animated themes.

![Daily Study Tracker](https://img.shields.io/badge/React-18-blue) ![Capacitor](https://img.shields.io/badge/Capacitor-Android-green) ![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ Features

### 📊 Study Tracking
- **6-Hour Daily Target** - Track study time across multiple subjects
- **Subject Management** - Customize subjects with planned vs actual hours
- **KPI Tracking** - Mark subjects as completed (Y/N)
- **Smart Day Rating** - Automatic rating based on your progress

### ✅ Productivity Tools
- **Daily Checklist** - Track specific study tasks
- **Quality Check** - Self-assessment questions
- **Error Log** - Document mistakes and learnings
- **Real-time Clock** - Stay aware of time

### 🎨 Beautiful Themes
| Theme | Description |
|-------|-------------|
| ☀️ Light | Warm cream tones with indigo accents |
| 🌙 Dark | Classic dark mode with indigo highlights |
| 🌿 Material Day | Fresh teal/mint aesthetic |
| 💜 Material Night | Modern purple/violet design |
| 🌸 Cherry Blossom | Animated falling petals |
| 🎋 Bamboo Forest | Peaceful green with floating leaves |
| 🌊 Ocean Depths | Underwater world with fish & bubbles |

### 📱 Cross-Platform
- **Web Browser** - Works on any modern browser
- **Android App** - Native APK with Capacitor
- **Persistent Storage** - Data saved locally on device

### 📤 Export Options
- **PDF Export** - Professional formatted report
- **Markdown Export** - Plain text for notes apps

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/sumon317/DailyStudyTracker.git
cd DailyStudyTracker

# Install dependencies
npm install

# Start development server
npm run dev
```

### Build for Production

```bash
npm run build
```

### Build Android APK

```bash
# Sync web assets to Android
npx cap sync android

# Open in Android Studio
npx cap open android

# Build APK: Build → Build Bundle(s) / APK(s) → Build APK(s)
```

## 🛠️ Tech Stack

- **Frontend**: React 18, Tailwind CSS
- **Animations**: Framer Motion, CSS Animations
- **Storage**: Dexie.js (IndexedDB), Capacitor Filesystem
- **Mobile**: Capacitor (Android)
- **Build**: Vite
- **Icons**: Lucide React

## 📁 Project Structure

```
DailyStudyTracker/
├── src/
│   ├── components/     # React components
│   ├── utils/          # PDF & Markdown generators
│   ├── db.js           # Database & storage logic
│   ├── App.jsx         # Main application
│   └── index.css       # Theme styles
├── android/            # Capacitor Android project
├── public/             # Static assets
└── dist/               # Production build
```

## 📸 Screenshots

*Coming soon*

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## 📄 License

This project is licensed under the MIT License.

## 👨‍💻 Author

**Sumon317** - [GitHub](https://github.com/sumon317)

---

Made with ❤️ for productive studying
