# Update System Implementation Plan

## Phase 1: Improve checkForUpdate.ts
- [ ] Add localStorage caching (check once per 24h)
- [ ] Add retry logic (3 attempts with backoff)
- [ ] Handle rate limiting gracefully

## Phase 2: Create UpdateModal Component
- [ ] Create `src/components/UpdateModal.tsx`
- [ ] Show update available message with version
- [ ] Display release notes (markdown-like)
- [ ] Show download progress bar
- [ ] Add "Update" and "Later" buttons
- [ ] Add "Don't remind me" checkbox

## Phase 3: Auto-Download & Install
- [ ] Add download function using @capacitor/filesystem
- [ ] Show progress updates
- [ ] Use @capacitor/app to install APK after download
- [ ] Handle download errors gracefully

## Phase 4: Integration
- [ ] Import UpdateModal in App.tsx
- [ ] Show modal when update available
- [ ] Handle "remind later" (store in localStorage)
- [ ] Add manual check for updates in menu

## Files to Create/Modify
- `src/utils/checkForUpdate.ts` - Improve with caching
- `src/components/UpdateModal.tsx` - NEW: Update popup modal
- `src/App.tsx` - Integrate modal
