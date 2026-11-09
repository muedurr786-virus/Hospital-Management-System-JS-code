(() => {
  'use strict';

  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal');
  const $toast = document.getElementById('toast');

  const S = {
    token: sessionStorage.getItem('hms_token'),
    user: null,
    patient: null,
    view: 'dashboard',
    authMode: 'login',
  };

  const GENDERS = ['Male', 'Female', 'Other'];
  const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

  /* ---------------- helpers ---------------- */
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '');

  async function api(path, method = 'GET', body) {
    const res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      if (res.status === 401 && S.token) { clearSession(); render(); }
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }

  function toast(msg, isErr = false) {
    $toast.textContent = msg;
    $toast.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => $toast.classList.add('hidden'), 3000);
  }

  function clearSession() {
    S.token = null; S.user = null; S.patient = null; S.view = 'dashboard';
    sessionStorage.removeItem('hms_token');
  }

  function setSession(token) {
    S.token = token;
    sessionStorage.setItem('hms_token', token);
  }

  const formData = (form) => Object.fromEntries(new FormData(form));

  /* ---------------- form field builders ---------------- */
  const input = (label, name, val = '', attrs = '') =>
    `<label>${esc(label)}<input name="${name}" value="${esc(val)}" ${attrs}></label>`;

  const select = (label, name, opts, val = '', blank = false) =>
    `<label>${esc(label)}<select name="${name}">${blank ? '<option value="">-- none --</option>' : ''}${opts
      .map((o) => `<option value="${esc(o)}" ${o === val ? 'selected' : ''}>${esc(o)}</option>`)
      .join('')}</select></label>`;

  function patientFields(p = {}) {
    return `
      ${input('Full name', 'name', p.name, 'required maxlength="100"')}
      <div class="grid2">
        ${input('Age', 'age', p.age, 'type="number" min="0" max="150" required')}
        ${select('Gender', 'gender', GENDERS, p.gender)}
      </div>
      <div class="grid2">
        ${input('Phone', 'phone', p.phone, 'required maxlength="20"')}
        ${select('Blood group', 'bloodGroup', BLOOD, p.bloodGroup, true)}
      </div>
      ${input('Address', 'address', p.address, 'maxlength="200"')}
      <label>Health problem / notes<textarea name="problem" maxlength="500">${esc(p.problem)}</textarea></label>`;
  }

  /* ---------------- modal ---------------- */
  function openModal(title, bodyHtml, onSubmit, submitLabel = 'Save') {
    $modal.innerHTML = `
      <h3>${esc(title)}</h3>
      <form id="modal-form">
        ${bodyHtml}
        <div class="error" id="modal-error"></div>
        <div class="modal-actions">
          <button type="button" class="btn secondary" id="modal-cancel">Cancel</button>
          <button type="submit" class="btn">${esc(submitLabel)}</button>
        </div>
      </form>`;
    $modal.querySelector('#modal-cancel').onclick = () => $modal.close();
    $modal.querySelector('#modal-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await onSubmit(formData(e.target));
        $modal.close();
      } catch (err) {
        $modal.querySelector('#modal-error').textContent = err.message;
      }
    };
    $modal.showModal();
  }

  /* ---------------- auth screen ---------------- */
  function renderAuth() {
    const login = S.authMode === 'login';
    $app.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <h1>🏥 Hospital Management System</h1>
          <p class="sub">${login ? 'Sign in to your account' : 'Create your patient account'}</p>
          <div class="tabs">
            <button class="${login ? 'active' : ''}" data-mode="login">Login</button>
            <button class="${login ? '' : 'active'}" data-mode="register">Patient Register</button>
          </div>
          <form id="auth-form">
            ${
              login
                ? `${input('Username', 'username', '', 'required autocomplete="username"')}
                   ${input('Password', 'password', '', 'type="password" required autocomplete="current-password"')}`
                : `${patientFields()}
                   ${input('Username', 'username', '', 'required minlength="3" maxlength="30" autocomplete="username"')}
                   ${input('Password', 'password', '', 'type="password" required minlength="6" autocomplete="new-password"')}`
            }
            <div class="error" id="auth-error"></div>
            <button class="btn" type="submit">${login ? 'Login' : 'Create account'}</button>
          </form>
          ${login ? '<p class="hint">Doctors, nurses and staff: use the ID created for you by the Admin.</p>' : ''}
        </div>
      </div>`;

    $app.querySelectorAll('.tabs button').forEach((b) => {
      b.onclick = () => { S.authMode = b.dataset.mode; renderAuth(); };
    });
    $app.querySelector('#auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const err = $app.querySelector('#auth-error');
      err.textContent = '';
      try {
        const data = await api(login ? '/login' : '/register', 'POST', formData(e.target));
        setSession(data.token);
        S.view = 'dashboard';
        await boot();
      } catch (ex) {
        err.textContent = ex.message;
      }
    };
  }

  /* ---------------- shell ---------------- */
  function navItems() {
    if (S.user.role === 'admin') return [['dashboard', 'Dashboard'], ['staff', 'Doctors / Nurses / Staff'], ['patients', 'Patients']];
    if (S.user.role === 'patient') return [['dashboard', 'Dashboard'], ['profile', 'My Profile']];
    return [['dashboard', 'Dashboard']];
  }

  function renderShell() {
    $app.innerHTML = `
      <div class="topbar">
        <div class="brand">🏥 HMS</div>
        <div class="who"><span>${esc(S.user.name)}</span><span class="badge">${esc(S.user.role)}</span>
          <button class="btn small secondary" id="logout">Logout</button></div>
      </div>
      <div class="shell">
        <nav class="sidebar">
          ${navItems().map(([k, l]) => `<button data-view="${k}" class="${S.view === k ? 'active' : ''}">${esc(l)}</button>`).join('')}
        </nav>
        <main class="main" id="main"></main>
      </div>`;

    $app.querySelectorAll('.sidebar button').forEach((b) => {
      b.onclick = () => { S.view = b.dataset.view; renderShell(); };
    });
    $app.querySelector('#logout').onclick = async () => {
      try { await api('/logout', 'POST'); } catch { /* ignore */ }
      clearSession();
      render();
    };
    loadView();
  }

  async function loadView() {
    const main = $app.querySelector('#main');
    try {
      if (S.view === 'dashboard') return await viewDashboard(main);
      if (S.view === 'staff') return await viewStaff(main);
      if (S.view === 'patients') return await viewPatients(main);
      if (S.view === 'profile') return await viewProfile(main);
    } catch (e) {
      main.innerHTML = `<div class="card error">${esc(e.message)}</div>`;
    }
  }

  /* ---------------- dashboards ---------------- */
  const statCards = (s) =>
    `<div class="stats">
      ${[['Patients', s.patients], ['Doctors', s.doctors], ['Nurses', s.nurses], ['Staff', s.staff]]
        .map(([l, v]) => `<div class="card stat"><span>${l}</span><strong>${v}</strong></div>`).join('')}
     </div>`;

  const patientRows = (list) =>
    list.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Age</th><th>Gender</th><th>Phone</th><th>Blood</th><th>Problem</th><th>Registered</th></tr></thead>
          <tbody>${list.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.age)}</td><td>${esc(p.gender)}</td>
            <td>${esc(p.phone)}</td><td>${esc(p.bloodGroup)}</td><td>${esc(p.problem).slice(0, 60)}</td><td>${fmtDate(p.createdAt)}</td></tr>`).join('')}
          </tbody></table></div>`
      : '<div class="empty">No patients yet.</div>';

  const profileCard = (p) =>
    `<div class="profile-list">
      ${[['Name', p.name], ['Age', p.age], ['Gender', p.gender], ['Phone', p.phone], ['Blood group', p.bloodGroup || '-'],
         ['Address', p.address || '-'], ['Health problem', p.problem || '-'], ['Registered', fmtDate(p.createdAt)]]
        .map(([l, v]) => `<div><span>${l}</span><strong>${esc(v)}</strong></div>`).join('')}
     </div>`;

  async function viewDashboard(main) {
    const d = await api('/dashboard');
    if (d.role === 'patient') {
      main.innerHTML = `<h2>Welcome, ${esc(S.user.name)}</h2>
        <div class="card"><h3>My Profile</h3>${d.patient ? profileCard(d.patient) : '<div class="empty">Profile not found.</div>'}</div>`;
    } else if (d.role === 'admin') {
      main.innerHTML = `<h2>Admin Dashboard</h2>${statCards(d.stats)}
        <div class="card"><h3>Recent patients</h3>${patientRows(d.recentPatients)}</div>`;
    } else {
      main.innerHTML = `<h2 class="cap">${esc(d.role)} Dashboard</h2>${statCards(d.stats)}
        <div class="card"><h3>All patients (view only)</h3>${patientRows(d.patients)}</div>`;
    }
  }

  /* ---------------- admin: staff ---------------- */
  const staffFields = (u = {}, isEdit = false) => `
    ${select('Role', 'role', ['doctor', 'nurse', 'staff'], u.role || 'doctor')}
    ${input('Full name', 'name', u.name, 'required maxlength="100"')}
    <div class="grid2">
      ${input('Phone', 'phone', u.phone, 'maxlength="20"')}
      ${input('Department', 'department', u.department, 'maxlength="60"')}
    </div>
    ${isEdit
      ? `<label>Username<input value="${esc(u.username)}" disabled></label>
         <label>New password <span class="hint">(leave blank to keep current)</span><input name="password" type="password" minlength="6" autocomplete="new-password"></label>`
      : `${input('Username (login ID)', 'username', '', 'required minlength="3" maxlength="30" autocomplete="off"')}
         ${input('Password', 'password', '', 'type="password" required minlength="6" autocomplete="new-password"')}`}`;

  async function viewStaff(main) {
    const { users } = await api('/users');
    main.innerHTML = `
      <h2>Doctors / Nurses / Staff</h2>
      <div class="card">
        <button class="btn" id="add-user">+ Create new ID</button>
      </div>
      <div class="card">
        ${users.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Role</th><th>Username</th><th>Department</th><th>Phone</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td>${esc(u.username)}</td>
            <td>${esc(u.department)}</td><td>${esc(u.phone)}</td><td>${fmtDate(u.createdAt)}</td>
            <td class="actions"><button class="btn small secondary" data-edit="${esc(u.id)}">Edit</button>
            <button class="btn small danger" data-del="${esc(u.id)}">Delete</button></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">No doctors, nurses or staff yet. Create the first ID.</div>'}
      </div>`;

    main.querySelector('#add-user').onclick = () =>
      openModal('Create doctor / nurse / staff ID', staffFields(), async (data) => {
        await api('/users', 'POST', data);
        toast('ID created');
        loadView();
      }, 'Create');

    main.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => {
        const u = users.find((x) => x.id === b.dataset.edit);
        openModal('Edit ' + u.name, staffFields(u, true), async (data) => {
          await api('/users/' + u.id, 'PUT', data);
          toast('Updated');
          loadView();
        });
      };
    });
    main.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const u = users.find((x) => x.id === b.dataset.del);
        if (!confirm(`Delete ${u.role} "${u.name}"? This cannot be undone.`)) return;
        try { await api('/users/' + u.id, 'DELETE'); toast('Deleted'); loadView(); } catch (e) { toast(e.message, true); }
      };
    });
  }

  /* ---------------- admin: patients ---------------- */
  async function viewPatients(main) {
    const { patients } = await api('/patients');
    main.innerHTML = `
      <h2>Patients</h2>
      <div class="card">
        ${patients.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Username</th><th>Age</th><th>Gender</th><th>Phone</th><th>Blood</th><th>Problem</th><th>Actions</th></tr></thead>
          <tbody>${patients.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.username)}</td><td>${esc(p.age)}</td>
            <td>${esc(p.gender)}</td><td>${esc(p.phone)}</td><td>${esc(p.bloodGroup)}</td><td>${esc(p.problem).slice(0, 40)}</td>
            <td class="actions"><button class="btn small secondary" data-edit="${esc(p.id)}">Edit</button>
            <button class="btn small danger" data-del="${esc(p.id)}">Delete</button></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">No patients registered yet.</div>'}
      </div>`;

    main.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => {
        const p = patients.find((x) => x.id === b.dataset.edit);
        openModal('Edit patient', patientFields(p), async (data) => {
          await api('/patients/' + p.id, 'PUT', data);
          toast('Updated');
          loadView();
        });
      };
    });
    main.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const p = patients.find((x) => x.id === b.dataset.del);
        if (!confirm(`Delete patient "${p.name}" and their login? This cannot be undone.`)) return;
        try { await api('/patients/' + p.id, 'DELETE'); toast('Deleted'); loadView(); } catch (e) { toast(e.message, true); }
      };
    });
  }

  /* ---------------- patient: own profile ---------------- */
  async function viewProfile(main) {
    const { patient } = await api('/me');
    S.patient = patient;
    main.innerHTML = `
      <h2>My Profile</h2>
      <div class="card">
        <h3>Edit profile</h3>
        <form id="profile-form">
          ${patientFields(patient)}
          <h3>Change password <span class="hint">(optional)</span></h3>
          <div class="grid2">
            ${input('Current password', 'currentPassword', '', 'type="password" autocomplete="current-password"')}
            ${input('New password', 'newPassword', '', 'type="password" minlength="6" autocomplete="new-password"')}
          </div>
          <div class="error" id="profile-error"></div>
          <div><button class="btn" type="submit">Save changes</button></div>
        </form>
      </div>
      <div class="card danger-zone">
        <h3>Delete my profile</h3>
        <p class="hint">This permanently deletes your profile and login. It cannot be undone.</p>
        <button class="btn danger" id="delete-me">Delete my profile</button>
      </div>`;

    main.querySelector('#profile-form').onsubmit = async (e) => {
      e.preventDefault();
      const err = main.querySelector('#profile-error');
      err.textContent = '';
      try {
        const data = await api('/me', 'PUT', formData(e.target));
        S.user = data.user;
        toast('Profile updated');
        renderShell();
      } catch (ex) { err.textContent = ex.message; }
    };

    main.querySelector('#delete-me').onclick = () => {
      openModal('Confirm deletion', `
        <p>Enter your password to permanently delete your profile.</p>
        ${input('Password', 'password', '', 'type="password" required autocomplete="current-password"')}`,
        async (data) => {
          await api('/me', 'DELETE', { password: data.password });
          clearSession();
          S.authMode = 'login';
          render();
          toast('Your profile has been deleted');
        }, 'Delete permanently');
    };
  }

  /* ---------------- boot ---------------- */
  function render() {
    if (!S.token || !S.user) return renderAuth();
    renderShell();
  }

  async function boot() {
    if (S.token) {
      try {
        const data = await api('/me');
        S.user = data.user;
        S.patient = data.patient;
      } catch { clearSession(); }
    }
    render();
  }

  boot();
})();
