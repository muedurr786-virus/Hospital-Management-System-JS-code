# Hospital Management System (JavaScript)

Pure Node.js backend (no npm packages needed) + vanilla JavaScript frontend.

## Run
```
node server.js        # or: npm start
```
Open http://localhost:3000

Default admin (created on first run): **admin / admin123**
Change before first run:  `ADMIN_USER=myadmin ADMIN_PASS=StrongPass1 node server.js`

## Roles & permissions
| Role | What they can do |
|------|------------------|
| Admin | Create / edit / delete Doctor, Nurse, Staff IDs. View, edit, delete patients. Dashboard. |
| Doctor / Nurse / Staff | ID is created by Admin only. Can only **view the dashboard** (stats + read-only patient list). |
| Patient | Registers himself/herself. Sees own dashboard. Edits and deletes **own** profile only (password needed to delete). |

## Security notes
- Passwords hashed with scrypt + random salt; never returned by API
- Role checks on every API route (server side)
- Login rate limit (10 failures / 15 min / IP), 8h sessions, input validation, 100KB body limit
- XSS-safe rendering (HTML escaped) + Content-Security-Policy
- For production: put behind HTTPS (e.g. nginx), and swap data/db.json for a real database

## Files
- `server.js` - API + static server
- `public/` - index.html, style.css, app.js
- `data/db.json` - created automatically

##admin Id & Password
On the Login tab (the default), enter:
Username: admin
Password: admin123

<img width="1918" height="927" alt="image" src="https://github.com/user-attachments/assets/c45d70e9-9f4f-4bb1-9fa2-7221804efc85" />
<img width="1897" height="929" alt="image" src="https://github.com/user-attachments/assets/ee0d7e29-7872-45df-b2f1-abb37f33099c" />
<img width="1919" height="929" alt="image" src="https://github.com/user-attachments/assets/a7b90d7d-80bd-4742-bad6-7fd01e3d08c5" />



