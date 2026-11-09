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
