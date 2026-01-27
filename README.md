# SimNotes – Cloud-Synced Notes App

SimNotes is a simple, fast, browser-based notes application with Google Authentication and cloud-synced storage, allowing you to access your notes from any device.

🔗 **Live App:** https://simnotes-5d6dc.web.app/

---

## 🚀 Features

- Google Sign-In for secure access
- Create, edit, and delete notes
- Cloud-synced notes across devices
- Desktop + Mobile compatible
- Dark mode toggle
- Search notes
- Firebase Hosting deployment

---

## 🛠️ Tech Stack

- HTML, CSS, JavaScript
- Firebase Authentication
- Firebase Firestore
- Firebase Hosting
- Firebase Compat SDK

---

## 📁 Project Structure

```
.
├── index.html
├── styles.css
├── app.js
├── firebase.json
├── .firebaserc
└── .gitignore
```

---

## ⚙️ Firebase Setup

1. Create a Firebase project
2. Enable Google Authentication
3. Enable Cloud Firestore
4. Add your Firebase config to `app.js`
5. Ensure your domain is listed under _Authorized Domains_
6. Deploy using:

```
firebase deploy --only hosting
```

---

## 📦 Run Locally

```
git clone https://github.com/edwinmathew2510/simNotes.git
cd simNotes
open index.html
```

Or use VS Code Live Server.

---

## 🔒 Firestore Security Rules (Recommended)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /notes/{noteId} {
      allow create: if request.auth != null && request.auth.uid == request.resource.data.ownerId;
      allow read, update, delete: if request.auth != null && request.auth.uid == resource.data.ownerId;
    }
  }
}
```

Adjust paths if you're using `users/{uid}/notes`.

---

## 🎯 Future Improvements

- Offline support
- Tags / categories
- Rich text editor
- Version history
- PWA support

---

## 📄 License

MIT License
