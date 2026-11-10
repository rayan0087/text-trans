# 🎙️ Transkrip Kilat (Auto-Transkrip Real-Time & AI)

Aplikasi auto-transkrip suara-ke-teks real-time berbasis **React**, **Vite**, dan **Tailwind CSS**. Bekerja langsung di browser tanpa perlu login, mengutamakan privasi dengan penyimpanan lokal di **IndexedDB**, mendukung ekspor ke format **.TXT** dan **.DOCX (Microsoft Word)**, serta menyediakan fitur kecerdasan buatan opsional dengan sistem **Bring Your Own Key (BYOK)**.

---

## ✨ Fitur Utama

- ⚡ **Transkrip Suara Real-Time:** Bicara langsung dan kata-kata muncul seketika di layar secara *live interim*.
- ⏸️ **Kontrol Rekaman Lengkap:** Tombol Mulai Rekam, Jeda (*Pause*), Lanjut (*Resume*), dan Selesai (*Stop*) disertai penghitung durasi waktu dan animasi gelombang audio (*visualizer*).
- 🔒 **100% Privat & Tanpa Login:** Tidak perlu registrasi akun. Seluruh data rekaman disimpan eksklusif di **IndexedDB** browser masing-masing pengguna.
- 💾 **Auto-Save & Riwayat:** Rekaman dan hasil ketikan tersimpan otomatis secara reaktif. Anda bisa mencari, membuka, atau menghapus riwayat rekaman kapan saja.
- 📄 **Ekspor Berkas:**
  - Unduh dokumen **Microsoft Word (.DOCX)** lengkap dengan judul, tanggal, durasi, transkrip, serta lampiran ringkasan AI.
  - Unduh berkas **Teks Biasa (.TXT)**.
  - Tombol salin cepat ke clipboard (*Copy to Clipboard*).
- 🌐 **Pilihan Bahasa:** Mendukung Bahasa Indonesia (`id-ID`) dan Bahasa Inggris (`en-US`).
- 🤖 **Kolaborasi AI Opsional (BYOK):**
  - **Rapikan Teks & Tanda Baca:** Memperbaiki teks lisan menjadi paragraf rapi dan bertata bahasa baik tanpa mengubah makna.
  - **Ringkasan Rapat:** Menghasilkan ringkasan eksekutif dan poin-poin penting.
  - **Action Items & Keputusan:** Otomatis mendeteksi daftar tugas dan keputusan dari rekaman.
  - Mendukung provider AI: **Google Gemini** (Gratis via Google AI Studio), **Groq Cloud** (Gratis), dan **OpenAI**.
  - Kunci API (*API Key*) hanya tersimpan di browser Anda sendiri.

---

## 🛠️ Stack Teknologi

- **Frontend:** [React 19](https://react.dev/) + [Vite](https://vite.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/)
- **Local Database:** [Dexie.js](https://dexie.org/) (Wrapper IndexedDB Reaktif)
- **Engine Speech-to-Text:** Web Speech API bawaan browser (`webkitSpeechRecognition`)
- **Document Exporter:** [docx](https://docx.js.org/) + [file-saver](https://github.com/eligrey/FileSaver.js/)
- **Icons:** [Lucide React](https://lucide.dev/)

---

## 🚀 Cara Menjalankan

### 1. Instalasi Dependensi
```bash
npm install
```

### 2. Jalankan Mode Pengembangan (Dev Server)
```bash
npm run dev
```
Buka alamat yang tampil di terminal (biasanya `http://localhost:5173/`) menggunakan **Google Chrome** atau **Microsoft Edge** untuk performa Web Speech API terbaik.

### 3. Build untuk Produksi
```bash
npm run build
```
Hasil build siap di-*deploy* di folder `dist/` ke platform statis mana pun (seperti Vercel, Netlify, GitHub Pages, atau Cloudflare Pages).

---

## 💡 Catatan Kompatibilitas Browser

Web Speech API (`webkitSpeechRecognition`) berjalan optimal pada browser berbasis Chromium:
- Google Chrome
- Microsoft Edge
- Brave / Opera / Vivaldi

---

## 📄 Lisensi
MIT License
