document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.auth-tab');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const card = document.getElementById('auth-card');

    // Animate card on load
    card.style.opacity = '0';
    card.style.transform = 'translateY(16px)';
    requestAnimationFrame(() => {
        card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
    });

    // ── Tab Switching ──
    function switchTab(tabName) {
        tabs.forEach(t => t.classList.remove('active'));
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        if (tabName === 'login') {
            loginForm.classList.remove('hidden');
            signupForm.classList.add('hidden');
        } else {
            loginForm.classList.add('hidden');
            signupForm.classList.remove('hidden');
        }
        clearErrors();
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // "Switch" links at the bottom of each form
    document.querySelectorAll('[data-switch]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab(link.dataset.switch);
        });
    });

    // Auto-switch if hash is #signup
    if (window.location.hash === '#signup') switchTab('signup');

    // ── Password Toggle ──
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.target);
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            btn.querySelector('.eye-open').classList.toggle('hidden', isPassword);
            btn.querySelector('.eye-closed').classList.toggle('hidden', !isPassword);
        });
    });

    // ── Error Helpers ──
    function showError(id, msg) {
        const el = document.getElementById(id);
        el.textContent = msg;
        el.classList.remove('hidden');
        // Find the parent form inputs and add error styling to all
        const form = el.closest('form');
        if (form) {
            const lastInput = el.previousElementSibling;
            // Shake animation
            el.style.animation = 'none';
            requestAnimationFrame(() => { el.style.animation = 'shake 0.4s ease'; });
        }
    }

    function clearErrors() {
        document.querySelectorAll('.inline-error').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.input-group.error').forEach(el => el.classList.remove('error'));
    }

    function setLoading(btnId, loading) {
        const btn = document.getElementById(btnId);
        const label = btn.querySelector('.btn-label');
        const spinner = btn.querySelector('.btn-spinner');
        btn.disabled = loading;
        label.style.opacity = loading ? '0' : '1';
        spinner.classList.toggle('hidden', !loading);
    }

    // ── Login ──
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearErrors();

        const identifier = document.getElementById('login-identifier').value.trim();
        const password = document.getElementById('login-password').value;

        if (!identifier || !password) {
            showError('login-error', 'Please fill in all fields.');
            return;
        }

        setLoading('login-submit', true);

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier, password })
            });
            const data = await res.json();

            if (!res.ok) {
                showError('login-error', data.error || 'Invalid credentials');
                setLoading('login-submit', false);
                return;
            }

            if (data.role === 'admin') {
                window.location.href = '/admin';
            } else {
                window.location.href = '/app';
            }
        } catch(err) {
            showError('login-error', 'Server error. Is the backend running?');
            setLoading('login-submit', false);
        }
    });

    // ── Signup ──
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearErrors();

        const email = document.getElementById('signup-email').value.trim();
        const username = document.getElementById('signup-username').value.trim();
        const password = document.getElementById('signup-password').value;

        if (!email || !username || !password) {
            showError('signup-error', 'Please fill in all fields.');
            return;
        }
        if (password.length < 6) {
            showError('signup-error', 'Password must be at least 6 characters.');
            return;
        }

        setLoading('signup-submit', true);

        try {
            const res = await fetch('/api/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, username, password })
            });
            const data = await res.json();

            if (!res.ok) {
                showError('signup-error', data.error || 'Signup failed');
                setLoading('signup-submit', false);
                return;
            }

            window.location.href = '/app';
        } catch(err) {
            showError('signup-error', 'Server error. Is the backend running?');
            setLoading('signup-submit', false);
        }
    });

    // ── Guest ──
    document.getElementById('auth-guest-btn').addEventListener('click', async () => {
        try {
            const res = await fetch('/api/guest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            if (res.ok) window.location.href = '/app';
        } catch(e) {
            alert('Server error.');
        }
    });
});
