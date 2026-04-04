# 📚 Daily Study Tracker

A beautiful, feature-rich study tracking application built with React and TypeScript. Track your daily study progress, set goals, and stay motivated with Material Design 3 themes.

![Daily Study Tracker](https://img.shields.io/badge/React-18-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue) ![Capacitor](https://img.shields.io/badge/Capacitor-Android-green) ![License](https://img.shields.io/badge/License-MIT-yellow)

### 🌐 Live Demo
The app is fully functional and live on the web at: **[dailystudytracker.onrender.com](https://dailystudytracker.onrender.com)**

## ✨ Features

### 📊 Study Tracking
- **Daily Target** - Track study time across multiple subjects
- **Subject Management** - Add or remove subjects dynamically
- **KPI Tracking** - Mark subjects as completed (Y/N)
- **Smart Day Rating** - Automatic rating based on your progress
- **Study Charts** - Visual pie charts and progress bars for time distribution

### 📈 Stats & Analysis
- **Weekly Stats** - View study patterns with bar charts
- **Study Streak** - Track consecutive days studied
- **Completion Rate** - See daily and weekly goal completion %

### ✅ Productivity Tools
- **Daily Checklist** - Track specific study tasks
- **Quality Check** - Self-assessment questions
- **Error Log** - Document mistakes and learnings
- **Real-time Clock** - Stay aware of time
- **Stopwatch** - Built-in timer for study sessions
- **Focus Timer** - Adjustable countdown timer with hours/minutes/seconds

### 🔔 Smart Notifications
- **Study Reminders** - Set specific times for each subject
- **Continuous Alarm** - High-priority alarm that rings for 30s+ to wake you up
- **Reliable Alerts** - Works even when app is closed or in background
- **One-Time Schedule** - Alarms ring only for the set day (no unwanted repeats)

### 📲 Home Screen Widget
- **Mini-App Widget** - View your schedule without opening the app
- **Widget Actions** - Play/Pause timer directly from home screen
- **Theme Toggle** - Switch between Dark and Light modes
- **Real-time Sync** - Updates instantly when app data changes

### 🎨 Material Design 3 Themes
| Theme | Description |
|-------|-------------|
| ☀️ Light | Clean light theme |
| 🌙 Dark | Easy on the eyes |
| 🔄 Auto | Follows system preference |
| 🌿 Material | Material You light |
| 💜 Material Dark | Material You dark |
| 💧 Adaptive | Pick any color from your screen |

### 📱 Cross-Platform
- **Web Browser** - Works on any modern browser
- **Android App** - Native APK with Capacitor
- **PWA** - Installable on any device with offline support
- **Persistent Storage** - Data saved locally on device
- **Auto-Save** - Automatically saves progress every 10 seconds

### 📤 Export & Backup
- **PDF Export** - Professional formatted report
- **Markdown Export** - Plain text for notes apps
- **Backup & Restore** - Export all data to JSON and restore on any device

## 🚀 Getting Started

### Prerequisites
- Node.js 20+
- npm

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

- **Frontend**: React 18, TypeScript (strict mode)
- **Styling**: Tailwind CSS, Material Design 3
- **Animations**: Framer Motion, CSS Animations
- **Storage**: Dexie.js (IndexedDB), Capacitor Filesystem
- **Mobile**: Capacitor 8 (Android)
- **Build**: Vite
- **Linting**: Biome
- **Testing**: Vitest + Testing Library
- **Icons**: Lucide React

## 📁 Project Structure

```
DailyStudyTracker/
├── src/
│   ├── components/     # React components
│   ├── pages/          # Route components (lazy-loaded)
│   ├── providers/      # Context providers (Theme, Data, Toast)
│   ├── types/          # TypeScript type definitions
│   ├── utils/          # Utilities (PDF, MD, notifications, sanitize)
│   ├── plugins/        # Capacitor native plugins
│   ├── db.ts           # Database & storage logic
│   ├── App.tsx         # Main application
│   └── main.tsx        # Entry point
├── android/            # Capacitor Android project
├── public/             # Static assets (PWA manifest, service worker)
└── dist/               # Production build
```

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## 📄 License

This project is licensed under the MIT License.

## 👨‍💻 Author

**Sumon317** - [GitHub](https://github.com/sumon317)

---

Made with ❤️ for productive studying
