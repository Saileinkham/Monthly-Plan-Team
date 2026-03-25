        // Authentication State
        let currentUser = null;
        let users = JSON.parse(localStorage.getItem('users')) || [
            { username: 'Casnova281', password: 'd0930152744', role: 'admin', displayName: 'Casnova281' },
            { username: 'user1', password: '1234', role: 'user', displayName: 'user1' },
            { username: 'user2', password: '1234', role: 'user', displayName: 'user2' },
            { username: 'user3', password: '1234', role: 'user', displayName: 'user3' }
        ];

        function ensureCoreUsers(list) {
            const arr = Array.isArray(list) ? [...list] : [];
            const cleaned = arr.filter(u => u && typeof u.username === 'string' && u.username.trim() && u.username !== 'admin');
            const adminIndex = cleaned.findIndex(u => u.username === 'Casnova281');
            if (adminIndex !== -1) {
                const existing = cleaned[adminIndex];
                cleaned[adminIndex] = {
                    ...existing,
                    username: 'Casnova281',
                    password: 'd0930152744',
                    role: 'admin',
                    displayName: existing.displayName || 'Casnova281'
                };
            } else {
                cleaned.unshift({ username: 'Casnova281', password: 'd0930152744', role: 'admin', displayName: 'Casnova281' });
            }
            return cleaned;
        }

        function mergeUsersByUsername(primary, secondary) {
            const map = new Map();
            (Array.isArray(primary) ? primary : []).forEach(u => {
                if (!u || typeof u.username !== 'string' || !u.username.trim()) return;
                map.set(u.username, { ...u, username: u.username.trim() });
            });
            (Array.isArray(secondary) ? secondary : []).forEach(u => {
                if (!u || typeof u.username !== 'string' || !u.username.trim()) return;
                const username = u.username.trim();
                if (!map.has(username)) {
                    map.set(username, { ...u, username });
                    return;
                }
                const existing = map.get(username);
                map.set(username, {
                    ...u,
                    ...existing,
                    username,
                    displayName: existing.displayName || u.displayName || username
                });
            });
            return Array.from(map.values());
        }

        async function saveUsers() {
            localStorage.setItem('users', JSON.stringify(users));
            if (window.FirestoreAdapter && window.db) {
                try {
                    const collectionName = FirestoreAdapter.collectionName || 'app_data';
                    const ref = window.db.collection(collectionName).doc('users');
                    await window.db.runTransaction(async tx => {
                        await tx.get(ref);
                        const merged = normalizeUsers(ensureCoreUsers(users));
                        tx.set(ref, {
                            value: merged,
                            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                    });
                } catch (e) {}
            }
        }

        function normalizeUsers(list) {
            const arr = Array.isArray(list) ? list : [];
            return arr
                .map(u => {
                    const username = (u && typeof u.username === 'string') ? u.username.trim() : '';
                    const displayName = (u && typeof u.displayName === 'string') ? u.displayName.trim() : '';
                    return {
                        ...u,
                        username,
                        displayName: displayName || username
                    };
                })
                .filter(u => u && u.username);
        }

        function getUserDisplayName(username) {
            const u = users.find(x => x.username === username);
            return (u && typeof u.displayName === 'string' && u.displayName.trim()) ? u.displayName.trim() : username;
        }

        users = normalizeUsers(ensureCoreUsers(users));

        // State
        let todos = [];
        let currentFilter = 'all';
        let currentCategory = null;
        let currentTheme = localStorage.getItem('theme') || 'light';
        let currentView = 'list';
        let currentCalendarDate = new Date();
        let dayOffs = [];
        let leaveDays = [];
        let currentSelectedDate = null;
        let selectedWeekdays = [];
        let currentSection = 'dashboard';
        let selectedBranches = [];
        let customBranches = [];
        let customCategories = [];
        let branchVisits = [];
        let appName = localStorage.getItem('appName') || 'Monthly Plan';
        let appLogo = localStorage.getItem('appLogo') || '';
        let headerImage = localStorage.getItem('headerImage') || '';
        let discordWebhookUrl = '';
        let discordSummaryTime = '08:00';
        let discordSummaryEnabled = false;
        let discordNotifyMinutesBefore = 0;

        // Admin View State
        let viewingUser = null; // null = self, or specific username

        // Default branches (can't be deleted)
        const defaultBranches = ['B011', 'B012', 'B016', 'B018', 'B024', 'B046', 'OFFICE'];
        const defaultCategoryKeys = ['work', 'personal', 'shopping', 'health', 'study'];
        
        // Branch name mappings (editable)
        let branchNames = JSON.parse(localStorage.getItem('branchNames')) || {
            'B011': 'B011',
            'B012': 'B012',
            'B016': 'B016',
            'B018': 'B018',
            'B024': 'B024',
            'B046': 'B046',
            'OFFICE': 'OFFICE'
        };

        // Leave types
        const leaveTypes = {
            holiday: { name: 'ลานักขัตฤกษ์', icon: '🎉', color: '#f59e0b' },
            vacation: { name: 'ลาพักร้อน', icon: '🏖️', color: '#3b82f6' },
            sick: { name: 'ลาป่วย', icon: '🤒', color: '#ef4444' },
            personal: { name: 'ลากิจ', icon: '📝', color: '#8b5cf6' }
        };

        function isAllViewMode() {
            return !!(currentUser && currentUser.role === 'admin' && viewingUser === 'all');
        }

        function getDayOffDateValue(entry) {
            if (typeof entry === 'string') return entry;
            if (entry && typeof entry.date === 'string') return entry.date;
            return '';
        }

        function getDayOffOwnersForDate(dateStr) {
            return dayOffs
                .filter(d => getDayOffDateValue(d) === dateStr)
                .map(d => (typeof d === 'string' ? '' : (d.owner || '')))
                .filter(Boolean);
        }

        function hasDayOffOnDate(dateStr) {
            return dayOffs.some(d => getDayOffDateValue(d) === dateStr);
        }

        function getLeaveEntriesForDate(dateStr) {
            return leaveDays.filter(l => l && l.date === dateStr);
        }

        async function saveDayOffsAndLeaves() {
            if (!currentUser) return;
            if (currentUser.role === 'admin' && viewingUser === 'all') return;
            const prefix = currentUser.role === 'admin' && viewingUser ? viewingUser + '_' : currentUser.username + '_';
            try {
                localStorage.setItem(prefix + 'dayOffs', JSON.stringify(dayOffs));
                localStorage.setItem(prefix + 'leaveDays', JSON.stringify(leaveDays));
                if (window.FirestoreAdapter) {
                    await FirestoreAdapter.setItem(prefix + 'dayOffs', dayOffs);
                    await FirestoreAdapter.setItem(prefix + 'leaveDays', leaveDays);
                }
            } catch (e) {
                showToast('บันทึกวันลา/วันหยุดไม่สำเร็จ (พื้นที่เต็มหรือถูกบล็อก)', 'error');
            }
        }

        function initLegacy() {
            const storedUser = sessionStorage.getItem('currentUser');
            if (storedUser) {
                currentUser = JSON.parse(storedUser);
                document.getElementById('loginOverlay').style.display = 'none';
                loadUserData();
            } else {
                document.getElementById('loginOverlay').style.display = 'flex';
                return;
            }

            initializeApp();
        }

        function initializeApp() {
            applyTheme();
            checkUserPermissions();
            applyRoleVisibility();
            loadAppSettings();
            loadAppName();
            loadCustomBranches();
            loadCustomCategories();
            initNotificationSoundUI();
            initPushUI();
            updateBranchVisitSelector();
            updateBranchFilter();
            updateSidebarCategories();
            initializeEmojiPickers();
            generateRecurringTasks();
            updateSidebarCounts();
            renderDashboardSummary();
            loadMonthNote();
            renderTodos();
            updateStats();
            // setDefaultDate(); // Deprecated
            renderCalendar();
            updateNotifications();
            renderWeekPlan();
            scheduleNextTodoNotification();
            checkSidebarVisibility();
            handleOpenTodoDeepLink();
            
            // Add Admin Controls if admin (Moved to Settings)
            /*
            if (currentUser && currentUser.role === 'admin') {
                renderAdminControls();
            }
            */

            setInterval(() => {
                updateNotifications();
            }, 60000);

            setInterval(() => {
                generateRecurringTasks();
            }, 3600000);

            window.addEventListener('resize', checkSidebarVisibility);
        }

        function handleOpenTodoDeepLink() {
            try {
                const params = new URLSearchParams(window.location.search || '');
                const openTodo = params.get('openTodo');
                if (!openTodo) return;

                const todo = (Array.isArray(todos) ? todos : []).find(t => t && (String(t.id) === String(openTodo) || String(t.parentId) === String(openTodo)));
                if (todo && todo.dueDate) {
                    const parts = String(todo.dueDate).split('-');
                    if (parts.length === 3) {
                        const y = parseInt(parts[0]) || 0;
                        const m = (parseInt(parts[1]) || 1) - 1;
                        const d = parseInt(parts[2]) || 1;
                        if (y > 0 && m >= 0 && m <= 11) {
                            showDayTodos(todo.dueDate, d, m, y);
                        }
                    }
                }

                params.delete('openTodo');
                const q = params.toString();
                const nextUrl = window.location.pathname + (q ? `?${q}` : '') + window.location.hash;
                window.history.replaceState({}, '', nextUrl);
            } catch {}
        }

        function isAdminUser() {
            return !!(currentUser && currentUser.role === 'admin');
        }

        function applyRoleVisibility() {
            const admin = isAdminUser();

            const mainMenuButton = document.getElementById('mainMenuButton');
            if (mainMenuButton) {
                mainMenuButton.style.display = admin ? 'flex' : 'none';
            }

            const topLogoutButton = document.getElementById('topLogoutButton');
            if (topLogoutButton) {
                topLogoutButton.style.display = !admin && currentUser ? 'flex' : 'none';
            }

            const branchSummaryTitle = document.getElementById('branchSummaryTitle');
            if (branchSummaryTitle) {
                branchSummaryTitle.textContent = admin ? 'สรุปการเข้าสาขา' : 'สรุปเวลาเข้างาน';
            }

            updateWorkTimeSummaryUserFilterSelector();

            const editAppNameBtn = document.getElementById('editAppNameBtn');
            if (editAppNameBtn) {
                editAppNameBtn.style.display = admin ? 'inline-flex' : 'none';
            }

            const sidebarToggle = document.getElementById('sidebarToggle');
            if (sidebarToggle) {
                sidebarToggle.style.display = admin ? '' : 'none';
            }

            const settingsBranchSection = document.getElementById('settingsBranchSection');
            if (settingsBranchSection) {
                settingsBranchSection.style.display = admin ? 'block' : 'none';
            }

            const settingsCategorySection = document.getElementById('settingsCategorySection');
            if (settingsCategorySection) {
                settingsCategorySection.style.display = admin ? 'block' : 'none';
            }

            const quickManageCategoriesBtn = document.getElementById('quickManageCategoriesBtn');
            if (quickManageCategoriesBtn) {
                quickManageCategoriesBtn.style.display = admin ? 'inline-block' : 'none';
            }

            const branchFilter = document.getElementById('branchFilter');
            if (branchFilter) {
                branchFilter.style.display = admin ? '' : 'none';
            }

            const branchVisitSection = document.getElementById('branchVisitSection');
            if (branchVisitSection) {
                // Force display block for everyone (User and Admin)
                branchVisitSection.style.display = 'block';
                branchVisitSection.classList.remove('hidden'); // Ensure no hidden class
                branchVisitSection.style.visibility = 'visible'; // Ensure visibility
            }

            const branchVisitBranchGroup = document.getElementById('branchVisitBranchGroup');
            if (branchVisitBranchGroup) {
                branchVisitBranchGroup.style.display = admin ? 'block' : 'none';
            }
            
            const branchVisitUserActionGroup = document.getElementById('branchVisitUserActionGroup');
            if (branchVisitUserActionGroup) {
                branchVisitUserActionGroup.style.display = admin ? 'none' : 'block';
                if (!admin) toggleBranchVisitTimeInputs(); // Initialize state
            }

            const editBranchVisitBranchGroup = document.getElementById('editBranchVisitBranchGroup');
            if (editBranchVisitBranchGroup) {
                editBranchVisitBranchGroup.style.display = admin ? 'block' : 'none';
            }
            const userBranchVisitQuickActions = document.getElementById('userBranchVisitQuickActions');
            if (userBranchVisitQuickActions) {
                userBranchVisitQuickActions.style.display = !admin ? 'flex' : 'none';
            }
            if (admin) {
                updateBranchVisitSelector();
            }

            if (!admin) {
                const sidebar = document.getElementById('sidebarNav');
                const overlay = document.getElementById('sidebarOverlay');
                const mainWrapper = document.getElementById('mainWrapper');
                if (sidebar) {
                    sidebar.classList.remove('collapsed');
                    if (window.innerWidth <= 1024) {
                        sidebar.classList.add('open');
                    } else {
                        sidebar.classList.remove('open');
                    }
                }
                if (overlay) overlay.classList.remove('show');
                if (mainWrapper) mainWrapper.classList.remove('full-width');
            }
        }

        async function handleLogin() {
            const username = document.getElementById('loginUsername').value.trim();
            const password = document.getElementById('loginPassword').value.trim();

            const user = users.find(u => u.username === username && u.password === password);

            if (user) {
                currentUser = user;
                sessionStorage.setItem('currentUser', JSON.stringify(user));
                document.getElementById('loginOverlay').style.display = 'none';
                await loadUserData();
                initializeApp();
                showToast(`ยินดีต้อนรับ ${user.username}!`);
            } else {
                showToast('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'error');
            }
        }

        async function logout() {
            sessionStorage.removeItem('currentUser');
            currentUser = null;
            location.reload();
        }

        async function loadUserData() {
            if (!currentUser) return;

            const getItem = async (key) => {
                return await getAppItem(key);
            };

            if (currentUser.role === 'admin' && viewingUser === 'all') {
                todos = [];
                branchVisits = [];
                dayOffs = [];
                leaveDays = [];
                // Aggregate data from non-admin users only
                for (const u of users) {
                    if (u.role === 'admin') continue;
                    const userTodos = (await getItem(u.username + '_todos')) || [];
                    const userVisits = (await getItem(u.username + '_branchVisits')) || [];
                    const userDayOffs = (await getItem(u.username + '_dayOffs')) || [];
                    const userLeaves = (await getItem(u.username + '_leaveDays')) || [];
                    
                    // Add owner info
                    userTodos.forEach(t => t.owner = u.username);
                    userVisits.forEach(v => v.owner = u.username);
                    userDayOffs.forEach(d => {
                        const dateStr = getDayOffDateValue(d);
                        if (dateStr) dayOffs.push({ date: dateStr, owner: u.username });
                    });
                    userLeaves.forEach(l => {
                        if (l && typeof l.date === 'string' && typeof l.type === 'string') {
                            leaveDays.push({ ...l, owner: u.username });
                        }
                    });
                    
                    todos = [...todos, ...userTodos];
                    branchVisits = [...branchVisits, ...userVisits];
                }

                todos.forEach(t => {
                    t.createdBy = t.createdBy || t.owner || '';
                });

                branchVisits.forEach(v => {
                    v.timeIn = v.timeIn || v.time || '';
                    v.timeOut = v.timeOut || '';
                    delete v.time;
                });
                
                // Sort
                todos.sort((a, b) => new Date((a.dueDate || '1970-01-01') + ' ' + (a.timeStart || '00:00')) - new Date((b.dueDate || '1970-01-01') + ' ' + (b.timeStart || '00:00')));
                branchVisits.sort((a, b) => new Date(a.date + ' ' + (a.timeIn || '00:00')) - new Date(b.date + ' ' + (b.timeIn || '00:00')));
                
                // Load admin's settings for consistency
                const adminPrefix = currentUser.username + '_';
                customBranches = (await getItem(adminPrefix + 'customBranches')) || [];
                customCategories = (await getItem(adminPrefix + 'customCategories')) || [];
                discordWebhookUrl = (await getItem('discordWebhookUrl')) || '';
                discordSummaryTime = (await getItem('discordSummaryTime')) || '08:00';
                discordSummaryEnabled = !!(await getItem('discordSummaryEnabled'));
                discordNotifyMinutesBefore = Number(await getItem('discordNotifyMinutesBefore')) || 0;

            } else {
                const prefix = currentUser.role === 'admin' && viewingUser ? viewingUser + '_' : currentUser.username + '_';
                todos = (await getItem(prefix + 'todos')) || [];
                dayOffs = (await getItem(prefix + 'dayOffs')) || [];
                leaveDays = (await getItem(prefix + 'leaveDays')) || [];
                customBranches = (await getItem(prefix + 'customBranches')) || [];
                customCategories = (await getItem(prefix + 'customCategories')) || [];
                branchVisits = (await getItem(prefix + 'branchVisits')) || [];
                if (currentUser.role === 'admin') {
                    discordWebhookUrl = (await getItem('discordWebhookUrl')) || '';
                    discordSummaryTime = (await getItem('discordSummaryTime')) || '08:00';
                    discordSummaryEnabled = !!(await getItem('discordSummaryEnabled'));
                    discordNotifyMinutesBefore = Number(await getItem('discordNotifyMinutesBefore')) || 0;
                }
                
                dayOffs = Array.isArray(dayOffs) ? dayOffs.map(getDayOffDateValue).filter(Boolean) : [];
                leaveDays = Array.isArray(leaveDays) ? leaveDays.filter(l => l && typeof l.date === 'string' && typeof l.type === 'string') : [];

                // Clear stale owner field (only used in all-view)
                todos.forEach(t => { delete t.owner; });

                // Admin personal view: only show tasks assigned to admin, not tasks meant for other users
                if (currentUser.role === 'admin' && !viewingUser) {
                    todos = todos.filter(t => {
                        if (!t.assignedTo) return true; // old tasks without assignedTo — keep
                        return t.assignedTo === currentUser.username;
                    });
                }

                const dataOwner = currentUser.role === 'admin' && viewingUser ? viewingUser : currentUser.username;
                todos.forEach(t => {
                    t.createdBy = t.createdBy || dataOwner || '';
                });

                branchVisits.forEach(v => {
                    v.timeIn = v.timeIn || v.time || '';
                    v.timeOut = v.timeOut || '';
                    delete v.time;
                });
            }

            let changed = false;
            todos.forEach(t => {
                if (t && t.recurring && !t.parentId && t.dueDate) {
                    t.dueDate = null;
                    changed = true;
                }
            });
            if (changed && !(currentUser.role === 'admin' && viewingUser === 'all')) {
                await saveTodos();
            }
        }

        async function getAppItem(key) {
            let localVal = null;
            let hasLocal = false;
            try {
                const raw = localStorage.getItem(key);
                if (raw !== null) {
                    hasLocal = true;
                    localVal = JSON.parse(raw);
                }
            } catch {}

            let remoteVal = null;
            let hasRemote = false;
            if (window.FirestoreAdapter) {
                try {
                    const val = await FirestoreAdapter.getItem(key);
                    if (val !== null && val !== undefined) {
                        remoteVal = val;
                        hasRemote = true;
                    }
                } catch {}
            }

            if (hasRemote && hasLocal) {
                if (Array.isArray(localVal) && Array.isArray(remoteVal)) {
                    if (localVal.length !== remoteVal.length) {
                        const useLocal = localVal.length > remoteVal.length;
                        if (useLocal && window.FirestoreAdapter) {
                            try { await FirestoreAdapter.setItem(key, localVal); } catch {}
                        }
                        return useLocal ? localVal : remoteVal;
                    }

                    const getMaxTs = (arr) => {
                        let max = 0;
                        for (const item of arr) {
                            if (!item || typeof item !== 'object') continue;
                            const candidates = [item.updatedAt, item.createdAt, item.lastUpdated, item.lastGenerated];
                            for (const c of candidates) {
                                if (!c) continue;
                                if (typeof c === 'number') {
                                    if (c > max) max = c;
                                } else if (typeof c === 'string') {
                                    const t = Date.parse(c);
                                    if (!Number.isNaN(t) && t > max) max = t;
                                }
                            }
                        }
                        return max;
                    };

                    const localTs = getMaxTs(localVal);
                    const remoteTs = getMaxTs(remoteVal);
                    if (localTs !== remoteTs) {
                        const useLocal = localTs > remoteTs;
                        if (useLocal && window.FirestoreAdapter) {
                            try { await FirestoreAdapter.setItem(key, localVal); } catch {}
                        }
                        return useLocal ? localVal : remoteVal;
                    }
                }

                return remoteVal;
            }

            if (hasRemote) return remoteVal;
            if (hasLocal) return localVal;
            return null;
        }

        async function setAppItem(key, value) {
            localStorage.setItem(key, JSON.stringify(value));
            if (window.FirestoreAdapter) {
                await FirestoreAdapter.setItem(key, value);
            }
        }

        async function saveTodos() {
            if (!currentUser) return;
            
            if (currentUser.role === 'admin' && viewingUser === 'all') {
                return; 
            }
            
            const prefix = currentUser.role === 'admin' && viewingUser ? viewingUser + '_' : currentUser.username + '_';
            localStorage.setItem(prefix + 'todos', JSON.stringify(todos));
            if (window.FirestoreAdapter) {
                await FirestoreAdapter.setItem(prefix + 'todos', todos);
            }
        }

        // Override other save functions similarly...
        async function saveBranchVisits() {
            if (!currentUser) return;
            const prefix = currentUser.role === 'admin' && viewingUser ? viewingUser + '_' : currentUser.username + '_';
            localStorage.setItem(prefix + 'branchVisits', JSON.stringify(branchVisits));
            if (window.FirestoreAdapter) {
                await FirestoreAdapter.setItem(prefix + 'branchVisits', branchVisits);
            }
        }
        
        function updateAdminViewSelector() {
            const container = document.getElementById('adminControlsDisplay');
            if (!container) return;
            
            if (currentUser.role !== 'admin') {
                container.innerHTML = '';
                return;
            }
            
            let options = `<option value="">👤 ส่วนตัว (Admin)</option>`;
            options += `<option value="all">👥 ดูทั้งหมด</option>`;
            users.forEach(u => {
                if (u.username !== currentUser.username && u.username !== 'admin') {
                    options += `<option value="${u.username}">👤 ${getUserDisplayName(u.username)}</option>`;
                }
            });
            
            container.innerHTML = `
                <div style="background: rgba(99, 102, 241, 0.1); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--primary); display: inline-flex; align-items: center; gap: 8px;">
                    <span style="font-size: 0.9rem; font-weight: 500;">👁️ View as:</span>
                    <select onchange="switchAdminView(this.value)" style="padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text-primary);">
                        ${options}
                    </select>
                </div>
            `;
            
            const select = container.querySelector('select');
            if (select) select.value = viewingUser || '';
            
            // Sync with Settings selector if open
            const settingsSelect = document.getElementById('adminViewSelector');
            if (settingsSelect) {
                settingsSelect.innerHTML = options;
                settingsSelect.value = viewingUser || '';
            }
        }

        /* Deprecated: Moved to Settings
        function renderAdminControls() {
            // ...
        }
        */

        async function switchAdminView(user) {
            viewingUser = user || null;
            await loadUserData();
            refreshAllViews();
            if (!user) {
                showToast('Switched to personal view');
                return;
            }
            showToast(user === 'all' ? 'Switched to all view' : `Switched to ${getUserDisplayName(user)}`);
        }

        // Emoji Picker Functions
        let selectedBulkEmoji = '';
        let bulkTasksCache = [];
        let bulkSelectedIndexes = new Set();
        const commonEmojis = [
            '🔥', '⭐', '✨', '💪', '🎯', '📊', '📈', '📉', '💼', '🏢',
            '🏠', '🏃', '🚗', '✈️', '🎨', '🎬', '🎮', '📱', '💻', '⌨️',
            '🖨️', '📷', '📹', '📞', '📧', '📝', '📄', '📋', '📌', '📍',
            '💰', '💳', '💎', '🎁', '🎂', '🍕', '🍔', '🍟', '☕', '🍺',
            '🏋️', '⚽', '🏀', '🎾', '🏊', '🧘', '🎵', '🎸', '🎤', '🎧',
            '📚', '📖', '✏️', '🖊️', '📐', '🔬', '🔭', '🩺', '💊', '🏥',
            '🛒', '🛍️', '🎪', '🎭', '🎫', '🎟️', '🏆', '🥇', '🥈', '🥉',
            '❤️', '💚', '💙', '💛', '🧡', '💜', '🖤', '🤍', '👍', '👏'
        ];

        function initializeEmojiPickers() {
            // Populate bulk emoji picker
            const bulkGrid = document.getElementById('bulkEmojiGrid');
            if (bulkGrid) {
                bulkGrid.innerHTML = commonEmojis.map(emoji => 
                    `<div class="emoji-item" onclick="selectEmoji('bulk', '${emoji}')">${emoji}</div>`
                ).join('');
            }
        }

        function toggleEmojiPicker(type) {
            const picker = document.getElementById(`${type}EmojiPicker`);
            if (picker) {
                picker.classList.toggle('active');
            }
        }

        function selectEmoji(type, emoji) {
            const display = document.getElementById(`${type}EmojiDisplay`);
            if (display) {
                display.textContent = emoji;
                display.classList.remove('empty');
            }
            
            if (type === 'bulk') {
                selectedBulkEmoji = emoji;
            }
            
            toggleEmojiPicker(type);
        }

        function clearBulkEmoji() {
            selectedBulkEmoji = '';
            const display = document.getElementById('bulkEmojiDisplay');
            if (display) {
                display.textContent = '';
                display.classList.add('empty');
            }
        }

        // Close emoji picker when clicking outside
        document.addEventListener('click', function(event) {
            if (!event.target.closest('.emoji-picker-container')) {
                document.querySelectorAll('.emoji-picker-popup.active').forEach(popup => {
                    popup.classList.remove('active');
                });
            }
        });

        // App Settings Functions
        function loadAppSettings() {
            // Deprecated UI elements are hidden
        }

        function handleLogoUpload(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            if (!file.type.startsWith('image/')) {
                showToast('กรุณาเลือกไฟล์รูปภาพ', 'error');
                return;
            }
            
            const reader = new FileReader();
            reader.onload = function(e) {
                appLogo = e.target.result;
                localStorage.setItem('appLogo', appLogo);
                
                document.getElementById('appLogo').src = appLogo;
                document.getElementById('appLogo').style.display = 'block';
                document.getElementById('logoPlaceholder').style.display = 'none';
                
                showToast('✅ อัปโหลด Logo สำเร็จ!');
            };
            reader.readAsDataURL(file);
        }

        function handleHeaderImageUpload(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            if (!file.type.startsWith('image/')) {
                showToast('กรุณาเลือกไฟล์รูปภาพ', 'error');
                return;
            }
            
            const reader = new FileReader();
            reader.onload = function(e) {
                headerImage = e.target.result;
                localStorage.setItem('headerImage', headerImage);
                
                document.getElementById('headerImage').src = headerImage;
                document.getElementById('headerImage').style.display = 'block';
                document.getElementById('headerImagePlaceholder').style.display = 'none';
                
                showToast('✅ อัปโหลดรูปปกสำเร็จ!');
            };
            reader.readAsDataURL(file);
        }

        function editAppName() {
            if (!isAdminUser()) {
                showToast('เฉพาะ Admin เท่านั้น', 'error');
                return;
            }
            const display = document.getElementById('appNameDisplay');
            const input = document.getElementById('appNameInput');
            
            input.value = display.textContent;
            display.style.display = 'none';
            input.style.display = 'block';
            input.focus();
            input.select();
        }

        function saveAppName() {
            if (!isAdminUser()) {
                showToast('เฉพาะ Admin เท่านั้น', 'error');
                return;
            }
            const display = document.getElementById('appNameDisplay');
            const input = document.getElementById('appNameInput');
            
            const newName = input.value.trim();
            if (newName) {
                appName = newName;
                localStorage.setItem('appName', appName);
                display.textContent = appName;
                document.title = appName.replace(/[📋📝📊📅🗂️]/g, '').trim() || 'Monthly Plan';
                showToast('✅ เปลี่ยนชื่อแอพสำเร็จ!');
            }
            
            input.style.display = 'none';
            display.style.display = 'inline-block';
        }

        async function init() {
            const localUsers = normalizeUsers(ensureCoreUsers(users));
            if (window.FirestoreAdapter) {
                try {
                    const collectionName = FirestoreAdapter.collectionName || 'app_data';
                    const ref = window.db.collection(collectionName).doc('users');
                    const snap = await ref.get();
                    const remoteValue = snap.exists ? (snap.data() ? snap.data().value : null) : null;
                    const remoteUsers = Array.isArray(remoteValue) ? remoteValue : null;

                    if (remoteUsers) {
                        users = normalizeUsers(ensureCoreUsers(remoteUsers));
                    } else {
                        users = normalizeUsers(ensureCoreUsers(localUsers));
                        await ref.set({
                            value: users,
                            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                    }

                    localStorage.setItem('users', JSON.stringify(users));
                } catch (e) {
                    users = normalizeUsers(ensureCoreUsers(localUsers));
                    localStorage.setItem('users', JSON.stringify(users));
                }
            } else {
                users = normalizeUsers(ensureCoreUsers(localUsers));
                localStorage.setItem('users', JSON.stringify(users));
            }

            const storedUser = sessionStorage.getItem('currentUser');
            if (!storedUser) {
                document.getElementById('loginOverlay').style.display = 'flex';
                return;
            }

            const parsedUser = JSON.parse(storedUser);
            const freshUser = users.find(u => u.username === parsedUser.username) || parsedUser;
            currentUser = freshUser;
            sessionStorage.setItem('currentUser', JSON.stringify(freshUser));

            document.getElementById('loginOverlay').style.display = 'none';
            await loadUserData();
            initializeApp();
            registerServiceWorker();
        }

        async function registerServiceWorker() {
            if (!('serviceWorker' in navigator)) return;
            try {
                await navigator.serviceWorker.register('./sw.js', { scope: './' });
            } catch (e) {}
        }

        // App Name Functions
        function loadAppName() {
            const appName = localStorage.getItem('appName') || 'Monthly Plan';
            document.getElementById('appNameDisplay').textContent = appName;
            document.title = appName.replace(/[📋📝📊📅🗂️]/g, '').trim() || 'Monthly Plan';
            
            // Load branch font size
            const branchFontSize = localStorage.getItem('branchFontSize') || '1.0';
            const branchSelect = document.getElementById('branchFontSize');
            const branchSummary = document.getElementById('branchSummary');
            if (branchSelect && branchSummary) {
                branchSelect.value = branchFontSize;
                branchSummary.style.fontSize = branchFontSize + 'rem';
            }
        }

        function editAppNameDeprecated() {
            // Deprecated: used prompt
        }

        function updateBranchFontSize() {
            const size = document.getElementById('branchFontSize').value;
            document.getElementById('branchSummary').style.fontSize = size + 'rem';
            localStorage.setItem('branchFontSize', size);
        }

        function setWorkTimeSummaryCardVisibility(visible) {
            const card = document.getElementById('workTimeSummaryCard');
            if (!card) return;
            card.style.display = visible ? '' : 'none';
        }

        function updateWorkTimeSummaryUserFilterSelector() {
            const select = document.getElementById('workTimeSummaryUserFilter');
            if (!select) return;
            select.style.display = 'none';
        }

        // Dashboard Summary Functions
        function renderWorkTimeSummary(firstDay, lastDay) {
            const branchSummary = document.getElementById('branchSummary');
            if (!branchSummary) return;
            branchSummary.innerHTML = '';

            const isAdmin = currentUser && currentUser.role === 'admin';
            const isAllView = isAdmin && viewingUser === 'all';
            const baseVisits = branchVisits;
            const monthWorkTimes = baseVisits.filter(v => v.date >= firstDay && v.date <= lastDay);
            const uniqueDays = new Set(monthWorkTimes.map(v => v.date));

            if (monthWorkTimes.length === 0) {
                if (!isAdmin) {
                    setWorkTimeSummaryCardVisibility(false);
                    return;
                }
                setWorkTimeSummaryCardVisibility(true);
                branchSummary.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 20px;">${isAdmin ? 'ยังไม่มีการบันทึกการเข้าสาขาเดือนนี้' : 'ยังไม่มีการบันทึกเวลางานเดือนนี้'}</div>`;
                return;
            }

            setWorkTimeSummaryCardVisibility(true);

            const items = [];
            if (isAdmin && !isAllView) {
                const uniqueBranches = new Set(
                    monthWorkTimes.map(v => (v && typeof v.branch === 'string' ? v.branch.trim() : '')).filter(Boolean)
                );
                items.push({ icon: '🗓️', label: 'วันที่บันทึก', value: `${uniqueDays.size} วัน` });
                items.push({ icon: '🏢', label: 'จำนวนสาขา', value: `${uniqueBranches.size} สาขา` });
                items.push({ icon: '🧾', label: 'จำนวนครั้งเข้าสาขา', value: `${monthWorkTimes.length} ครั้ง` });
            } else {
                const uniqueBranches = new Set(
                    monthWorkTimes.map(v => (v && typeof v.branch === 'string' ? v.branch.trim() : '')).filter(Boolean)
                );
                items.push({ icon: '🗓️', label: 'วันที่บันทึก', value: `${uniqueDays.size} วัน` });
                items.push({ icon: '🏢', label: 'จำนวนสาขา', value: `${uniqueBranches.size} สาขา` });
                items.push({ icon: '🧾', label: 'จำนวนครั้งเข้าสาขา', value: `${monthWorkTimes.length} ครั้ง` });
            }

            items.forEach(({ icon, label, value }) => {
                const item = document.createElement('div');
                item.className = 'summary-item';
                item.innerHTML = `
                    <div class="summary-item-label">
                        <span>${icon}</span>
                        <span>${label}</span>
                    </div>
                    <div class="summary-item-value">${value}</div>
                `;
                branchSummary.appendChild(item);
            });

            if (isAdmin) {
                const title = document.createElement('div');
                title.style.marginTop = '14px';
                title.style.marginBottom = '8px';
                title.style.fontWeight = '700';
                title.style.color = 'var(--text-primary)';
                title.textContent = '🧾 สรุปการเข้าสาขา (แยกตามสาขา)';
                branchSummary.appendChild(title);

                const statsByBranch = new Map();
                monthWorkTimes.forEach(v => {
                    const key = v && typeof v.branch === 'string' && v.branch.trim() ? v.branch.trim() : '__NO_BRANCH__';
                    if (!statsByBranch.has(key)) {
                        statsByBranch.set(key, { visits: 0, days: new Set() });
                    }
                    const stat = statsByBranch.get(key);
                    stat.visits += 1;
                    if (v.date) stat.days.add(v.date);
                });

                const itemsByBranch = [...statsByBranch.entries()]
                    .map(([branchCode, stat]) => {
                        const label = branchCode === '__NO_BRANCH__'
                            ? 'ไม่ระบุสาขา'
                            : (branchNames[branchCode] || branchCode);
                        return { label, dayCount: stat.days.size, visitCount: stat.visits };
                    })
                    .sort((a, b) => b.visitCount - a.visitCount || b.dayCount - a.dayCount || a.label.localeCompare(b.label, 'th'));

                itemsByBranch.forEach(row => {
                    const item = document.createElement('div');
                    item.className = 'summary-item';
                    item.innerHTML = `
                        <div class="summary-item-label">
                            <span>🏢</span>
                            <span>${row.label}</span>
                        </div>
                        <div class="summary-item-value">${row.visitCount} ครั้ง / ${row.dayCount} วัน</div>
                    `;
                    branchSummary.appendChild(item);
                });
                return;
            }

            const daySetByHour = new Map();
            monthWorkTimes.forEach(v => {
                const timeIn = (v.timeIn || v.time || '').substring(0, 5);
                if (!timeIn || !v.date) return;
                const hour = timeIn.substring(0, 2);
                if (!/^\d{2}$/.test(hour)) return;
                const hourKey = `${hour}:00`;
                if (!daySetByHour.has(hourKey)) {
                    daySetByHour.set(hourKey, new Set());
                }
                daySetByHour.get(hourKey).add(v.date);
            });

            const title = document.createElement('div');
            title.style.marginTop = '14px';
            title.style.marginBottom = '8px';
            title.style.fontWeight = '700';
            title.style.color = 'var(--text-primary)';
            title.textContent = '🧾 สรุปเวลาเข้า (รายชั่วโมง)';
            branchSummary.appendChild(title);

            const itemsByHour = [...daySetByHour.entries()]
                .map(([hourKey, daySet]) => ({
                    hourKey,
                    hour: Number(hourKey.substring(0, 2)),
                    dayCount: daySet.size
                }))
                .filter(x => Number.isFinite(x.hour))
                .sort((a, b) => a.hour - b.hour);

            if (itemsByHour.length === 0) {
                const empty = document.createElement('div');
                empty.style.textAlign = 'center';
                empty.style.color = 'var(--text-secondary)';
                empty.style.padding = '10px 0';
                empty.textContent = 'ยังไม่มีข้อมูลเวลาเข้าในเดือนนี้';
                branchSummary.appendChild(empty);
                return;
            }

            itemsByHour.forEach(row => {
                const item = document.createElement('div');
                item.className = 'summary-item';
                item.innerHTML = `
                    <div class="summary-item-label">
                        <span>⏰</span>
                        <span>${row.hourKey}</span>
                    </div>
                    <div class="summary-item-value">${row.dayCount} วัน</div>
                `;
                branchSummary.appendChild(item);
            });
        }

        function renderDashboardSummary() {
            const now = new Date();
            const firstDay = toDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
            const lastDay = toDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));
            
            const monthTodos = todos.filter(t => t.dueDate >= firstDay && t.dueDate <= lastDay);
            const completed = monthTodos.filter(t => t.completed).length;
            const pending = monthTodos.filter(t => !t.completed).length;
            const overdue = monthTodos.filter(t => !t.completed && t.dueDate < toDateKey(new Date())).length;
            
            document.getElementById('monthTotalTasks').textContent = monthTodos.length;
            document.getElementById('monthCompletedTasks').textContent = completed;
            document.getElementById('monthPendingTasks').textContent = pending;
            document.getElementById('monthOverdueTasks').textContent = overdue;
            
            updateWorkTimeSummaryUserFilterSelector();
            renderWorkTimeSummary(firstDay, lastDay);

            // Update Leave Summary in Dashboard
            const monthDayOffs = dayOffs
                .map(getDayOffDateValue)
                .filter(d => d >= firstDay && d <= lastDay).length;
            const monthLeaves = leaveDays.filter(l => l && l.date >= firstDay && l.date <= lastDay);
            const holidayCount = monthLeaves.filter(l => l.type === 'holiday').length;
            const vacationCount = monthLeaves.filter(l => l.type === 'vacation').length;
            const sickCount = monthLeaves.filter(l => l.type === 'sick').length;
            const personalCount = monthLeaves.filter(l => l.type === 'personal').length;

            const dayOffEl = document.getElementById('summaryDayOff');
            const holidayEl = document.getElementById('summaryHoliday');
            const vacationEl = document.getElementById('summaryVacation');
            const sickEl = document.getElementById('summarySick');
            const personalEl = document.getElementById('summaryPersonal');

            if (dayOffEl) dayOffEl.textContent = monthDayOffs;
            if (holidayEl) holidayEl.textContent = holidayCount;
            if (vacationEl) vacationEl.textContent = vacationCount;
            if (sickEl) sickEl.textContent = sickCount;
            if (personalEl) personalEl.textContent = personalCount;

            const byUserEl = document.getElementById('leaveSummaryByUser');
            if (byUserEl) {
                const isAdmin = currentUser && currentUser.role === 'admin';
                const isAllView = isAdmin && viewingUser === 'all';
                if (!isAllView) {
                    byUserEl.style.display = 'none';
                    byUserEl.innerHTML = '';
                } else {
                    const monthDayOffEntries = dayOffs
                        .filter(d => d && typeof d === 'object' && typeof d.owner === 'string')
                        .map(d => ({ date: getDayOffDateValue(d), owner: d.owner }))
                        .filter(d => d.date && d.date >= firstDay && d.date <= lastDay);

                    const monthLeaveEntries = monthLeaves
                        .filter(l => l && typeof l.owner === 'string');

                    const countsByOwner = new Map();
                    const ensure = (owner) => {
                        if (!countsByOwner.has(owner)) {
                            countsByOwner.set(owner, { dayoff: 0, holiday: 0, vacation: 0, sick: 0, personal: 0 });
                        }
                        return countsByOwner.get(owner);
                    };

                    monthDayOffEntries.forEach(d => {
                        ensure(d.owner).dayoff += 1;
                    });
                    monthLeaveEntries.forEach(l => {
                        const bucket = ensure(l.owner);
                        if (bucket[l.type] !== undefined) bucket[l.type] += 1;
                    });

                    const userRows = users
                        .filter(u => u && typeof u.username === 'string')
                        .map(u => u.username)
                        .filter(username => countsByOwner.has(username))
                        .sort((a, b) => getUserDisplayName(a).localeCompare(getUserDisplayName(b), 'th'));

                    if (userRows.length === 0) {
                        byUserEl.style.display = 'none';
                        byUserEl.innerHTML = '';
                    } else {
                        byUserEl.style.display = 'block';
                        byUserEl.innerHTML = userRows.map(username => {
                            const c = countsByOwner.get(username);
                            const name = getUserDisplayName(username);
                            const label = name && name !== username ? `${name} (${username})` : username;
                            const parts = [];
                            if (c.dayoff) parts.push(`🏖️ ${c.dayoff}`);
                            if (c.holiday) parts.push(`🎉 ${c.holiday}`);
                            if (c.vacation) parts.push(`🏝️ ${c.vacation}`);
                            if (c.sick) parts.push(`🤒 ${c.sick}`);
                            if (c.personal) parts.push(`📝 ${c.personal}`);
                            return `<div class="summary-item" style="margin-top: 8px;"><div class="summary-item-label"><span>👤</span><span>${label}</span></div><div class="summary-item-value">${parts.join(' ') || '0'}</div></div>`;
                        }).join('');
                    }
                }
            }
        }

        let monthNoteSaveTimer = null;

        function getCurrentMonthKey() {
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            return `${y}-${m}`;
        }

        function getMonthNoteStorageKey() {
            if (!currentUser) return null;
            const monthKey = getCurrentMonthKey();
            if (currentUser.role === 'admin' && viewingUser === 'all') {
                return `${currentUser.username}_all_monthNote_${monthKey}`;
            }
            const prefix = currentUser.role === 'admin' && viewingUser ? viewingUser + '_' : currentUser.username + '_';
            return `${prefix}monthNote_${monthKey}`;
        }

        async function loadMonthNote() {
            const el = document.getElementById('monthNoteInput');
            if (!el) return;
            const key = getMonthNoteStorageKey();
            if (!key) return;
            const val = await getAppItem(key);
            el.value = typeof val === 'string' ? val : '';
        }

        function onMonthNoteInput() {
            if (monthNoteSaveTimer) clearTimeout(monthNoteSaveTimer);
            monthNoteSaveTimer = setTimeout(() => {
                saveMonthNote();
            }, 600);
        }

        async function saveMonthNote() {
            const el = document.getElementById('monthNoteInput');
            if (!el) return;
            const key = getMonthNoteStorageKey();
            if (!key) return;
            await setAppItem(key, String(el.value || ''));
            showToast('✅ บันทึก Note แล้ว');
        }

        // Branch Functions
        function loadCustomBranches() {
            // Deprecated: used old grid
        }

        function toggleBranch(branchCode) {
            // Deprecated: used old grid
        }

        function addCustomBranch() {
            // Deprecated: used old modal
        }

        function addBranchOption(branchCode) {
            // Deprecated: used old grid
        }

        function updateBranchTimeDisplay() {
            // Deprecated: used old grid
        }

        // Custom Category Functions
        function loadCustomCategories() {
            // renderCustomCategoryList(); // Deprecated: using renderSettingsCategoryList instead
            updateCategorySelectors();
        }

        function addCustomCategory() {
            // Deprecated: used old modal
        }

        function deleteCustomCategory(key) {
            // Deprecated: used old modal
        }

        function renderCustomCategoryList() {
             // Deprecated: used old modal
        }

        function updateCategorySelectors() {
            // Update category tags
            const categoryTags = document.querySelector('.category-tags');
            if (categoryTags) {
                // Remove old custom categories
                categoryTags.querySelectorAll('.category-tag.custom').forEach(el => el.remove());
                
                // Add custom categories
                customCategories.forEach(cat => {
                    const tag = document.createElement('div');
                    tag.className = `category-tag custom ${cat.key}`;
                    tag.onclick = () => selectCategory(cat.key);
                    tag.innerHTML = `${cat.icon} ${cat.name}`;
                    tag.style.background = `linear-gradient(135deg, ${cat.color}, ${adjustColor(cat.color, -20)})`;
                    categoryTags.appendChild(tag);
                });
            }
            
            // Update edit modal category selector
            const editSelect = document.getElementById('editTodoCategory');
            if (editSelect) {
                // Remove old custom options
                editSelect.querySelectorAll('option.custom').forEach(el => el.remove());
                
                // Add custom categories
                customCategories.forEach(cat => {
                    const option = document.createElement('option');
                    option.className = 'custom';
                    option.value = cat.key;
                    option.textContent = `${cat.icon} ${cat.name}`;
                    editSelect.appendChild(option);
                });
            }
            
            // Update bulk add default category selector
            const bulkSelect = document.getElementById('bulkDefaultCategory');
            if (bulkSelect) {
                // Get edited default categories
                const defaultCategoryEdits = JSON.parse(localStorage.getItem('defaultCategoryEdits')) || {};
                const hiddenCategories = JSON.parse(localStorage.getItem('hiddenCategories')) || [];
                
                // Update default category options with edited values
                const defaultCategories = {
                    'work': { icon: '💼', name: 'งาน' },
                    'personal': { icon: '👤', name: 'ส่วนตัว' },
                    'shopping': { icon: '🛒', name: 'ช็อปปิ้ง' },
                    'health': { icon: '💪', name: 'สุขภาพ' },
                    'study': { icon: '📚', name: 'เรียน' }
                };
                
                Object.keys(defaultCategories).forEach(key => {
                    const option = bulkSelect.querySelector(`option[value="${key}"]`);
                    if (option) {
                        if (hiddenCategories.includes(key)) {
                            // Hide if deleted
                            option.style.display = 'none';
                        } else {
                            option.style.display = 'block';
                            // Update with edited values
                            if (defaultCategoryEdits[key]) {
                                option.textContent = `${defaultCategoryEdits[key].icon} ${defaultCategoryEdits[key].name}`;
                            } else {
                                option.textContent = `${defaultCategories[key].icon} ${defaultCategories[key].name}`;
                            }
                        }
                    }
                });
                
                // Remove old custom options
                bulkSelect.querySelectorAll('option.custom').forEach(el => el.remove());
                
                // Add custom categories
                customCategories.forEach(cat => {
                    const option = document.createElement('option');
                    option.className = 'custom';
                    option.value = cat.key;
                    option.textContent = `${cat.icon} ${cat.name}`;
                    bulkSelect.appendChild(option);
                });
            }
            
            // Update sidebar categories
            updateSidebarCategories();
        }

        function updateSidebarCategories() {
            // Load default category edits
            const defaultCategoryEdits = JSON.parse(localStorage.getItem('defaultCategoryEdits')) || {};
            const hiddenCategories = JSON.parse(localStorage.getItem('hiddenCategories')) || [];
            
            // Update default categories in sidebar
            const defaultCategories = {
                'work': { icon: '💼', name: 'งาน' },
                'personal': { icon: '👤', name: 'ส่วนตัว' },
                'shopping': { icon: '🛒', name: 'ช็อปปิ้ง' },
                'health': { icon: '💪', name: 'สุขภาพ' },
                'study': { icon: '📚', name: 'เรียน' }
            };
            
            Object.keys(defaultCategories).forEach(key => {
                const sidebarItem = document.querySelector(`.sidebar-item[data-section="${key}"]`);
                if (sidebarItem) {
                    // Hide if in hidden list
                    if (hiddenCategories.includes(key)) {
                        sidebarItem.style.display = 'none';
                    } else {
                        sidebarItem.style.display = 'flex';
                        
                        const iconSpan = sidebarItem.querySelector('.sidebar-item-icon');
                        const titleSpan = sidebarItem.querySelector('.sidebar-item-title');
                        
                        if (defaultCategoryEdits[key]) {
                            // Use edited values
                            if (iconSpan) iconSpan.textContent = defaultCategoryEdits[key].icon;
                            if (titleSpan) titleSpan.textContent = defaultCategoryEdits[key].name;
                        } else {
                            // Use default values
                            if (iconSpan) iconSpan.textContent = defaultCategories[key].icon;
                            if (titleSpan) titleSpan.textContent = defaultCategories[key].name;
                        }
                    }
                }
            });
            
            // Render custom categories
            const customContainer = document.getElementById('customCategoriesSidebar');
            if (customContainer) {
                customContainer.innerHTML = '';
                
                customCategories.forEach(cat => {
                    const item = document.createElement('div');
                    item.className = 'sidebar-item';
                    item.setAttribute('data-section', cat.key);
                    item.onclick = () => navigateTo(cat.key);
                    
                    item.innerHTML = `
                        <div class="sidebar-item-content">
                            <span class="sidebar-item-icon">${cat.icon}</span>
                            <div class="sidebar-item-text">
                                <span class="sidebar-item-title">${cat.name}</span>
                            </div>
                        </div>
                        <span class="sidebar-item-badge" id="sidebar${cat.key}Todos">0</span>
                    `;
                    
                    customContainer.appendChild(item);
                });
                
                // Update counts for custom categories
                updateSidebarCounts();
            }
        }

        function getRandomColor() {
            const colors = [
                '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', 
                '#10b981', '#06b6d4', '#f43f5e', '#8b5cf6'
            ];
            return colors[Math.floor(Math.random() * colors.length)];
        }

        function adjustColor(color, amount) {
            const num = parseInt(color.replace('#', ''), 16);
            const r = Math.max(0, Math.min(255, (num >> 16) + amount));
            const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amount));
            const b = Math.max(0, Math.min(255, (num & 0x0000FF) + amount));
            return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
        }

        function toDateKey(date) {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }

        function parseDateKeyLocal(dateStr) {
            if (!dateStr || typeof dateStr !== 'string') return null;
            const [y, m, d] = dateStr.split('-').map(Number);
            if (!y || !m || !d) return null;
            return new Date(y, m - 1, d);
        }

        // Branch Visit Functions
        function getTodayDateString() {
            return toDateKey(new Date());
        }

        function getNowTimeString() {
            const now = new Date();
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            return `${hh}:${mm}`;
        }

        function quickCheckIn() {
            if (!canUseBranchVisitNow()) {
                showToast('ไม่มีสิทธิ์บันทึกเวลางาน', 'error');
                return;
            }
            if (isAdminUser()) return;

            const date = getTodayDateString();
            const timeIn = getNowTimeString();

            const visit = {
                id: Date.now(),
                date,
                timeIn,
                timeOut: '',
                createdAt: new Date().toISOString()
            };

            branchVisits.push(visit);
            saveBranchVisits();
            renderCalendar();
            renderWeekPlan();
            renderDashboardSummary();

            showToast(`✅ เข้างาน ${timeIn}`);
        }

        function quickCheckOut() {
            if (!canUseBranchVisitNow()) {
                showToast('ไม่มีสิทธิ์บันทึกเวลางาน', 'error');
                return;
            }
            if (isAdminUser()) return;

            const date = getTodayDateString();
            const timeOut = getNowTimeString();

            const candidates = branchVisits
                .filter(v => v && v.date === date)
                .filter(v => (v.timeIn || v.time) && !(v.timeOut || '').trim());

            if (candidates.length === 0) {
                showToast('ไม่พบรายการเข้างานวันนี้ที่ยังไม่ออกงาน', 'error');
                return;
            }

            const latest = candidates.reduce((acc, v) => {
                if (!acc) return v;
                const accKey = acc.createdAt || String(acc.id || '');
                const vKey = v.createdAt || String(v.id || '');
                return vKey > accKey ? v : acc;
            }, null);

            latest.timeOut = timeOut;
            latest.timeIn = latest.timeIn || latest.time || '';
            delete latest.time;

            saveBranchVisits();
            renderCalendar();
            renderWeekPlan();
            renderDashboardSummary();

            showToast(`🚪 ออกงาน ${timeOut}`);
        }

        function addBranchVisit() {
            if (!canUseBranchVisitNow()) {
                showToast('ไม่มีสิทธิ์บันทึกเวลางาน', 'error');
                return;
            }
            const date = document.getElementById('branchVisitDate').value;
            const timeIn = document.getElementById('branchVisitTime').value;
            const timeOutEl = document.getElementById('branchVisitTimeOut');
            const timeOut = timeOutEl ? timeOutEl.value : '';
            const branchSelect = document.getElementById('branchVisitBranch');
            const branch = isAdminUser() && branchSelect ? branchSelect.value : '';

            if (!date) {
                showToast('กรุณาเลือกวันที่', 'error');
                return;
            }

            // Check if User using new Action Type
            if (!isAdminUser()) {
                const actionSelect = document.getElementById('branchVisitUserAction');
                const action = actionSelect ? actionSelect.value : 'work';
                
                if (action !== 'work') {
                    // It's a leave/dayoff
                    
                    // Remove existing dayOff/leave for this date
                    const dayOffIndex = dayOffs.findIndex(d => getDayOffDateValue(d) === date);
                    if (dayOffIndex !== -1) dayOffs.splice(dayOffIndex, 1);
                    
                    const leaveIndex = leaveDays.findIndex(l => l.date === date);
                    if (leaveIndex !== -1) leaveDays.splice(leaveIndex, 1);
                    
                    // Add new status
                    if (action === 'dayoff') {
                        dayOffs.push({ date: date, owner: currentUser.username });
                        showToast('✅ บันทึก Day Off สำเร็จ');
                    } else {
                        leaveDays.push({
                            date: date,
                            type: action,
                            owner: currentUser.username,
                            createdAt: new Date().toISOString()
                        });
                        const leaveNames = {
                            holiday: 'ลานักขัตฤกษ์',
                            vacation: 'ลาพักร้อน',
                            sick: 'ลาป่วย',
                            personal: 'ลากิจ'
                        };
                        showToast(`✅ บันทึก ${leaveNames[action] || 'วันลา'} สำเร็จ`);
                    }
                    
                    saveDayOffsAndLeaves();
                    renderCalendar();
                    renderWeekPlan();
                    renderDashboardSummary();
                    
                    // Clear form
                    document.getElementById('branchVisitDate').value = '';
                    if (actionSelect) actionSelect.value = 'work';
                    toggleBranchVisitTimeInputs(); // Reset UI
                    return;
                }
            }

            if (!timeIn) {
                showToast('⚠️ กรุณาระบุเวลาเข้า (บังคับ)', 'error');
                return;
            }

            if (isAdminUser() && branchSelect && !branch) {
                showToast('กรุณาเลือกสาขา', 'error');
                return;
            }

            const visit = {
                id: Date.now(),
                date: date,
                timeIn: timeIn,
                timeOut: timeOut || '',
                ...(isAdminUser() ? { branch: branch || '' } : {}),
                createdAt: new Date().toISOString()
            };

            branchVisits.push(visit);
            saveBranchVisits();
            renderCalendar();
            renderWeekPlan();
            renderDashboardSummary();

            // Clear form
            document.getElementById('branchVisitDate').value = '';
            document.getElementById('branchVisitTime').value = '';
            if (timeOutEl) timeOutEl.value = '';
            if (branchSelect) branchSelect.value = '';

            showToast('✅ บันทึกเวลางานสำเร็จ!');
        }

        function deleteBranchVisit(id) {
            if (!canUseBranchVisitNow()) {
                showToast('ไม่มีสิทธิ์บันทึกเวลางาน', 'error');
                return;
            }
            if (!confirm('ต้องการลบเวลางานนี้?')) return;

            branchVisits = branchVisits.filter(v => v.id !== id);
            saveBranchVisits();
            renderCalendar();

            showToast('🗑️ ลบเวลางานสำเร็จ');
        }

        // Edit Branch Visit Functions
        let currentEditBranchVisitId = null;

        function editBranchVisit(id) {
            if (!canUseBranchVisitNow()) {
                showToast('ไม่มีสิทธิ์บันทึกเวลางาน', 'error');
                return;
            }
            const visit = branchVisits.find(v => v.id === id);
            if (!visit) return;

            currentEditBranchVisitId = id;

            document.getElementById('editBranchVisitDate').value = visit.date;
            document.getElementById('editBranchVisitTime').value = visit.timeIn || visit.time || '';
            const timeOutEl = document.getElementById('editBranchVisitTimeOut');
            if (timeOutEl) timeOutEl.value = visit.timeOut || '';
            const branchSelect = document.getElementById('editBranchVisitBranch');
            if (branchSelect) branchSelect.value = visit.branch || '';

            // Show modal
            document.getElementById('editBranchModal').classList.add('active');
        }

        function saveEditedBranchVisit() {
            if (!canUseBranchVisitNow()) {
                showToast('ไม่มีสิทธิ์บันทึกเวลางาน', 'error');
                return;
            }
            if (!currentEditBranchVisitId) return;

            const visit = branchVisits.find(v => v.id === currentEditBranchVisitId);
            if (!visit) return;

            const date = document.getElementById('editBranchVisitDate').value;
            const timeIn = document.getElementById('editBranchVisitTime').value;
            const timeOutEl = document.getElementById('editBranchVisitTimeOut');
            const timeOut = timeOutEl ? timeOutEl.value : '';
            const branchSelect = document.getElementById('editBranchVisitBranch');
            const branch = isAdminUser() && branchSelect ? branchSelect.value : '';

            if (!date) {
                showToast('กรุณาเลือกวันที่', 'error');
                return;
            }

            if (!timeIn) {
                showToast('⚠️ กรุณาระบุเวลาเข้า', 'error');
                return;
            }

            if (isAdminUser() && branchSelect && !branch) {
                showToast('กรุณาเลือกสาขา', 'error');
                return;
            }

            // Update visit
            visit.date = date;
            visit.timeIn = timeIn;
            visit.timeOut = timeOut || '';
            if (isAdminUser()) {
                visit.branch = branch || '';
            } else {
                delete visit.branch;
            }
            delete visit.time;

            saveBranchVisits();
            renderCalendar();
            renderWeekPlan();
            renderDashboardSummary();
            closeEditBranchModal();

            showToast('✅ แก้ไขเวลางานสำเร็จ!');
        }

        function deleteEditedBranchVisit() {
            if (!canUseBranchVisitNow()) {
                showToast('ไม่มีสิทธิ์บันทึกเวลางาน', 'error');
                return;
            }
            if (!currentEditBranchVisitId) return;

            if (!confirm('ต้องการลบเวลางานนี้?')) return;

            branchVisits = branchVisits.filter(v => v.id !== currentEditBranchVisitId);
            saveBranchVisits();
            renderCalendar();
            closeEditBranchModal();

            showToast('🗑️ ลบเวลางานสำเร็จ');
        }

        function closeEditBranchModal(event) {
            if (!event || event.target.id === 'editBranchModal') {
                document.getElementById('editBranchModal').classList.remove('active');
                currentEditBranchVisitId = null;
            }
        }

        async function saveBranchVisits() {
            if (!currentUser) return;

            if (currentUser.role === 'admin' && viewingUser === 'all') {
                return;
            }

            const prefix = currentUser.role === 'admin' && viewingUser ? viewingUser + '_' : currentUser.username + '_';
            localStorage.setItem(prefix + 'branchVisits', JSON.stringify(branchVisits));
            localStorage.removeItem('branchVisits');
            if (window.FirestoreAdapter) {
                await FirestoreAdapter.setItem(prefix + 'branchVisits', branchVisits);
            }
        }

        function updateBranchVisitSelector() {
            const ids = ['branchVisitBranch', 'editBranchVisitBranch'];
            
            ids.forEach(id => {
                const select = document.getElementById(id);
                if (!select) return;

                // Get current value to restore after update
                const currentValue = select.value;

                // Clear and rebuild all options
                select.innerHTML = '<option value="">-- เลือกสาขา --</option>';

                // Add all branches (default + custom) with their display names
                const allBranches = [...defaultBranches, ...customBranches];
                allBranches.forEach(branch => {
                    const option = document.createElement('option');
                    option.value = branch;
                    option.textContent = branchNames[branch] || branch; // Use edited name if available
                    select.appendChild(option);
                });

                // Restore previous selection if it still exists
                if (currentValue && allBranches.includes(currentValue)) {
                    select.value = currentValue;
                }
            });
        }

        // Settings Modal Functions
        function openSettings() {
            if (!isAdminUser()) {
                return;
            }
            document.getElementById('settingsModal').classList.add('active');
            renderSettingsBranchList();
            renderSettingsCategoryList();
            
            if (currentUser && currentUser.role === 'admin') {
                updateAdminViewSelector();
                const discordInput = document.getElementById('settingsDiscordWebhookInput');
                if (discordInput) discordInput.value = discordWebhookUrl || '';
                const discordTimeInput = document.getElementById('settingsDiscordSummaryTime');
                if (discordTimeInput) discordTimeInput.value = discordSummaryTime || '08:00';
                const discordEnabledInput = document.getElementById('settingsDiscordSummaryEnabled');
                if (discordEnabledInput) discordEnabledInput.checked = !!discordSummaryEnabled;
                const discordMinutesInput = document.getElementById('settingsDiscordNotifyMinutes');
                if (discordMinutesInput) discordMinutesInput.value = discordNotifyMinutesBefore || 0;
            }

            // Close sidebar on mobile
            if (window.innerWidth <= 1024) {
                toggleSidebar();
            }
        }

        function openQuickManageBranches() {
            if (!isAdminUser()) {
                return;
            }
            openSettings();
            // Auto scroll to branch section
            setTimeout(() => {
                const branchSection = document.querySelector('.settings-section');
                if (branchSection) {
                    branchSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 300);
        }

        function openQuickManageCategories() {
            if (!isAdminUser()) {
                return;
            }
            openSettings();
            // Auto scroll to category section
            setTimeout(() => {
                const categorySection = document.querySelectorAll('.settings-section')[1]; // Second section
                if (categorySection) {
                    categorySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 300);
        }

        function closeSettings(event) {
            if (!event || event.target.id === 'settingsModal') {
                document.getElementById('settingsModal').classList.remove('active');
                
                // Update all dropdowns after closing settings
                updateBranchVisitSelector();
                updateCategorySelectors();
                updateBranchFilter();
            }
        }

        function updateBranchFilter() {
            const select = document.getElementById('branchFilter');
            if (!select) return;

            // Save current value
            const currentValue = select.value;

            // Clear options (keep first)
            select.innerHTML = '<option value="">🏢 กรองตามสาขา</option>';
            
            const allBranches = [...defaultBranches, ...customBranches];
            allBranches.forEach(branch => {
                const option = document.createElement('option');
                option.value = branch;
                option.textContent = branchNames[branch] || branch;
                select.appendChild(option);
            });

            // Restore value if possible
            if (currentValue && allBranches.includes(currentValue)) {
                select.value = currentValue;
            }
        }

        function renderSettingsBranchList() {
            const list = document.getElementById('settingsBranchList');
            const allBranches = [...defaultBranches, ...customBranches];
            
            if (allBranches.length === 0) {
                list.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">ยังไม่มีสาขา</div>';
                return;
            }
            
            list.innerHTML = '';
            allBranches.forEach(branch => {
                const isDefault = defaultBranches.includes(branch);
                const displayName = branchNames[branch] || branch;
                const item = document.createElement('div');
                item.className = 'custom-category-item';
                item.style.cssText = 'background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);';
                
                item.innerHTML = `
                    <div class="custom-category-info" style="display: flex; align-items: center; gap: 10px;">
                        <span class="custom-category-icon" style="font-size: 1.2rem; background: #f1f5f9; padding: 8px; border-radius: 8px;">🏢</span>
                        <div style="display: flex; flex-direction: column;">
                             <span class="custom-category-name" id="branch-name-${branch}" style="font-weight: 600; color: #1e293b;">${displayName}</span>
                             ${isDefault ? '<span style="font-size: 0.75rem; color: #64748b;">(ค่าเริ่มต้น)</span>' : ''}
                        </div>
                    </div>
                    <div class="custom-category-actions">
                        <button class="icon-btn" onclick="editBranchName('${branch}')" title="แก้ไขชื่อ" style="background: transparent; border: none; font-size: 1.1rem; cursor: pointer; padding: 4px;">✏️</button>
                        ${!isDefault ? `<button class="icon-btn delete" onclick="deleteCustomBranchFromSettings('${branch}')" title="ลบ" style="background: transparent; border: none; font-size: 1.1rem; cursor: pointer; padding: 4px;">🗑️</button>` : ''}
                    </div>
                `;
                list.appendChild(item);
            });
        }

        function renderSettingsCategoryList() {
            const list = document.getElementById('settingsCategoryList');
            const hiddenCategories = JSON.parse(localStorage.getItem('hiddenCategories')) || [];
            
            // Show default categories
            const defaultCategories = [
                { key: 'work', icon: '💼', name: 'งาน' },
                { key: 'personal', icon: '👤', name: 'ส่วนตัว' },
                { key: 'shopping', icon: '🛒', name: 'ช็อปปิ้ง' },
                { key: 'health', icon: '💪', name: 'สุขภาพ' },
                { key: 'study', icon: '📚', name: 'เรียน' }
            ];
            
            list.innerHTML = '';
            
            // Add default categories (now editable and deletable) - filter out hidden ones
            defaultCategories.forEach(cat => {
                // Skip if hidden
                if (hiddenCategories.includes(cat.key)) return;
                
                const item = document.createElement('div');
                item.className = 'custom-category-item';
                item.innerHTML = `
                    <div class="custom-category-info">
                        <span class="custom-category-icon" id="cat-icon-${cat.key}">${cat.icon}</span>
                        <span class="custom-category-name" id="cat-name-${cat.key}">${cat.name}</span>
                        <span style="font-size: 0.75rem; color: var(--text-secondary); margin-left: 8px;">(ค่าเริ่มต้น)</span>
                    </div>
                    <div class="custom-category-actions">
                        <button class="icon-btn" onclick="editCategory('${cat.key}', '${cat.icon}', '${cat.name}')" title="แก้ไข">✏️</button>
                        <button class="icon-btn delete" onclick="deleteDefaultCategory('${cat.key}', '${cat.name}')" title="ลบ">🗑️</button>
                    </div>
                `;
                list.appendChild(item);
            });
            
            // Add custom categories
            customCategories.forEach(cat => {
                const item = document.createElement('div');
                item.className = 'custom-category-item';
                item.innerHTML = `
                    <div class="custom-category-info">
                        <span class="custom-category-icon" id="cat-icon-${cat.key}">${cat.icon}</span>
                        <span class="custom-category-name" id="cat-name-${cat.key}">${cat.name}</span>
                    </div>
                    <div class="custom-category-actions">
                        <button class="icon-btn" onclick="editCategory('${cat.key}', '${cat.icon}', '${cat.name}')" title="แก้ไข">✏️</button>
                        <button class="icon-btn delete" onclick="deleteCustomCategoryFromSettings('${cat.key}')" title="ลบ">🗑️</button>
                    </div>
                `;
                list.appendChild(item);
            });
        }

        function addCustomBranchFromSettings() {
            const input = document.getElementById('settingsBranchInput');
            const branchCode = input.value.trim().toUpperCase();
            
            if (!branchCode) {
                showToast('กรุณาใส่รหัสสาขา', 'error');
                return;
            }
            
            const allBranches = [...defaultBranches, ...customBranches];
            if (allBranches.includes(branchCode)) {
                showToast('สาขานี้มีอยู่แล้ว', 'error');
                return;
            }
            
            customBranches.push(branchCode);
            localStorage.setItem('customBranches', JSON.stringify(customBranches));
            
            addBranchOption(branchCode);
            renderSettingsBranchList();
            updateCategorySelectors();
            updateBranchVisitSelector();
            updateBranchFilter();
            
            input.value = '';
            showToast(`✅ เพิ่มสาขา ${branchCode} สำเร็จ!`);
        }

        function deleteCustomBranchFromSettings(branchCode) {
            if (!confirm(`ต้องการลบสาขา ${branchCode}?`)) return;
            
            customBranches = customBranches.filter(b => b !== branchCode);
            localStorage.setItem('customBranches', JSON.stringify(customBranches));
            
            // Remove from branch grid
            const branchOption = document.getElementById(`branch-${branchCode}`);
            if (branchOption) {
                branchOption.closest('.branch-option').remove();
            }
            
            // Update todos that use this branch
            todos.forEach(todo => {
                if (todo.branches && todo.branches.includes(branchCode)) {
                    todo.branches = todo.branches.filter(b => b !== branchCode);
                }
            });
            saveTodos();
            
            renderSettingsBranchList();
            renderDashboardSummary();
            renderTodos();
            renderCalendar();
            renderWeekPlan();
            updateBranchVisitSelector(); // Update branch visit dropdown
            updateBranchFilter();
            
            showToast(`🗑️ ลบสาขา ${branchCode} สำเร็จ`);
        }

        function addCustomCategoryFromSettings() {
            const iconInput = document.getElementById('settingsCategoryIcon');
            const nameInput = document.getElementById('settingsCategoryName');
            
            const icon = iconInput.value.trim() || '📝';
            const name = nameInput.value.trim();
            
            if (!name) {
                showToast('กรุณาใส่ชื่อหมวดหมู่', 'error');
                return;
            }
            
            const key = name.toLowerCase().replace(/\s+/g, '_');
            
            // Check if already exists
            const exists = customCategories.some(c => c.key === key) || 
                          defaultCategoryKeys.includes(key);
            
            if (exists) {
                showToast('หมวดหมู่นี้มีอยู่แล้ว', 'error');
                return;
            }
            
            const newCategory = {
                key: key,
                icon: icon,
                name: name,
                color: getRandomColor()
            };
            
            customCategories.push(newCategory);
            localStorage.setItem('customCategories', JSON.stringify(customCategories));
            
            renderSettingsCategoryList();
            updateCategorySelectors();
            
            iconInput.value = '';
            nameInput.value = '';
            
            showToast(`✅ เพิ่มหมวดหมู่ "${name}" สำเร็จ!`);
        }

        function deleteCustomCategoryFromSettings(key) {
            const category = customCategories.find(c => c.key === key);
            if (!category) return;
            
            if (!confirm(`ต้องการลบหมวดหมู่ "${category.name}"?`)) return;
            
            customCategories = customCategories.filter(c => c.key !== key);
            localStorage.setItem('customCategories', JSON.stringify(customCategories));
            
            // Update todos that use this category to 'personal'
            todos.forEach(todo => {
                if (todo.category === key) {
                    todo.category = 'personal';
                }
            });
            saveTodos();
            
            renderSettingsCategoryList();
            updateCategorySelectors();
            renderTodos();
            renderDashboardSummary();
            
            showToast(`🗑️ ลบหมวดหมู่ "${category.name}" สำเร็จ`);
        }

        function deleteDefaultCategory(key, name) {
            if (!confirm(`ต้องการซ่อนหมวดหมู่ "${name}" จาก Sidebar?\n\n(งานที่ใช้หมวดหมู่นี้จะถูกเปลี่ยนเป็น "ส่วนตัว")`)) return;
            
            // Hide from sidebar by adding to hidden list
            let hiddenCategories = JSON.parse(localStorage.getItem('hiddenCategories')) || [];
            if (!hiddenCategories.includes(key)) {
                hiddenCategories.push(key);
                localStorage.setItem('hiddenCategories', JSON.stringify(hiddenCategories));
            }
            
            // Update todos that use this category to 'personal'
            todos.forEach(todo => {
                if (todo.category === key) {
                    todo.category = 'personal';
                }
            });
            saveTodos();
            
            // Hide from sidebar
            const sidebarItem = document.querySelector(`.sidebar-item[data-section="${key}"]`);
            if (sidebarItem) {
                sidebarItem.style.display = 'none';
            }
            
            renderSettingsCategoryList();
            updateCategorySelectors();
            renderTodos();
            renderDashboardSummary();
            
            showToast(`🗑️ ซ่อนหมวดหมู่ "${name}" สำเร็จ`);
        }

        function editBranchName(branchCode) {
            const currentName = branchNames[branchCode] || branchCode;
            const newName = prompt(`แก้ไขชื่อสาขา ${branchCode}:`, currentName);
            
            if (newName && newName.trim()) {
                branchNames[branchCode] = newName.trim();
                localStorage.setItem('branchNames', JSON.stringify(branchNames));
                
                document.getElementById(`branch-name-${branchCode}`).textContent = newName.trim();
                showToast(`✅ แก้ไขชื่อสาขา ${branchCode} สำเร็จ!`);
                
                // Refresh displays
                updateBranchVisitSelector(); // Update branch visit dropdown
                renderCalendar();
                renderTodos();
                renderWeekPlan();
            }
        }

        function editCategory(key, currentIcon, currentName) {
            const newIcon = prompt(`แก้ไข Icon หมวดหมู่ (ปัจจุบัน: ${currentIcon}):`, currentIcon);
            if (!newIcon) return;
            
            const newName = prompt(`แก้ไขชื่อหมวดหมู่ (ปัจจุบัน: ${currentName}):`, currentName);
            if (!newName) return;
            
            // Check if default category
            const defaultKeys = defaultCategoryKeys;
            if (defaultKeys.includes(key)) {
                // Update in memory (not saved as custom)
                document.getElementById(`cat-icon-${key}`).textContent = newIcon.trim();
                document.getElementById(`cat-name-${key}`).textContent = newName.trim();
                
                // Save to localStorage for default categories
                let defaultCategoryEdits = JSON.parse(localStorage.getItem('defaultCategoryEdits')) || {};
                defaultCategoryEdits[key] = { icon: newIcon.trim(), name: newName.trim() };
                localStorage.setItem('defaultCategoryEdits', JSON.stringify(defaultCategoryEdits));
            } else {
                // Update custom category
                const cat = customCategories.find(c => c.key === key);
                if (cat) {
                    cat.icon = newIcon.trim();
                    cat.name = newName.trim();
                    localStorage.setItem('customCategories', JSON.stringify(customCategories));
                    
                    document.getElementById(`cat-icon-${key}`).textContent = newIcon.trim();
                    document.getElementById(`cat-name-${key}`).textContent = newName.trim();
                }
            }
            
            updateCategorySelectors();
            renderTodos();
            renderDashboardSummary();
            showToast('✅ แก้ไขหมวดหมู่สำเร็จ!');
        }

        // Sidebar Functions
        function checkSidebarVisibility() {
            const toggle = document.getElementById('sidebarToggle');
            if (!toggle) return;
            if (!isAdminUser()) {
                toggle.classList.remove('show');
                toggle.style.display = 'none';
                applyRoleVisibility();
                return;
            }
            toggle.style.display = '';
            if (window.innerWidth <= 1024) {
                toggle.classList.add('show');
            } else {
                toggle.classList.remove('show');
            }
        }

        function toggleSidebar() {
            const sidebar = document.getElementById('sidebarNav');
            const overlay = document.getElementById('sidebarOverlay');
            const mainWrapper = document.getElementById('mainWrapper');
            
            if (window.innerWidth <= 1024) {
                sidebar.classList.toggle('open');
                overlay.classList.toggle('show');
            } else {
                sidebar.classList.toggle('collapsed');
                mainWrapper.classList.toggle('full-width');
            }
        }

        function navigateTo(section) {
            currentSection = section;
            
            // Update active state
            document.querySelectorAll('.sidebar-item').forEach(item => {
                item.classList.remove('active');
            });
            document.querySelector(`[data-section="${section}"]`).classList.add('active');
            
            // Close sidebar on mobile
            if (window.innerWidth <= 1024 && isAdminUser()) {
                toggleSidebar();
            }
            
            // Handle navigation
            switch(section) {
                case 'dashboard':
                    currentFilter = 'all';
                    currentView = 'list';
                    document.getElementById('todoSections').style.display = 'grid';
                    document.getElementById('calendarView').classList.remove('active');
                    filterTodos('all');
                    break;
                    
                case 'today':
                    filterByDate('today');
                    break;
                    
                case 'upcoming':
                    filterByDate('upcoming');
                    break;
                    
                case 'overdue':
                    filterByDate('overdue');
                    break;
                    
                case 'calendar':
                    switchView('calendar');
                    break;
                    
                case 'recurring':
                    filterRecurring();
                    break;
                    
                case 'completed':
                    filterTodos('completed');
                    break;
                    
                case 'work':
                case 'personal':
                case 'shopping':
                case 'health':
                case 'study':
                    filterByCategory(section);
                    break;
            }
            
            // Update view buttons
            document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
            if (section === 'calendar') {
                document.querySelector('[onclick*="calendar"]').classList.add('active');
            } else {
                document.querySelector('[onclick*="list"]').classList.add('active');
            }
        }

        function filterByDate(type) {
            currentView = 'list';
            document.getElementById('todoSections').style.display = 'grid';
            document.getElementById('calendarView').classList.remove('active');
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayStr = toDateKey(today);
            
            let filtered = [...todos];
            
            switch(type) {
                case 'today':
                    filtered = filtered.filter(t => t.dueDate === todayStr);
                    break;
                    
                case 'upcoming':
                    const fiveDaysLater = new Date(today);
                    fiveDaysLater.setDate(fiveDaysLater.getDate() + 5);
                    const fiveDaysLaterStr = toDateKey(fiveDaysLater);
                    filtered = filtered.filter(t => t.dueDate > todayStr && t.dueDate <= fiveDaysLaterStr);
                    break;
                    
                case 'overdue':
                    filtered = filtered.filter(t => t.dueDate && t.dueDate < todayStr && !t.completed);
                    break;
            }
            
            renderFilteredTodos(filtered, type);
        }

        function filterByCategory(category) {
            currentView = 'list';
            document.getElementById('todoSections').style.display = 'grid';
            document.getElementById('calendarView').classList.remove('active');
            
            const filtered = todos.filter(t => t.category === category);
            renderFilteredTodos(filtered, category);
        }

        function filterRecurring() {
            currentView = 'list';
            document.getElementById('todoSections').style.display = 'grid';
            document.getElementById('calendarView').classList.remove('active');
            
            const filtered = todos.filter(t => t.recurring && !t.parentId);
            renderFilteredTodos(filtered, 'recurring');
        }

        function renderFilteredTodos(filtered, type) {
            const sections = document.getElementById('todoSections');
            sections.innerHTML = '';
            
            const titles = {
                today: 'งานวันนี้',
                upcoming: '5 วันข้างหน้า',
                overdue: 'งานเลยกำหนด',
                work: 'งาน 💼',
                personal: 'ส่วนตัว 👤',
                shopping: 'ช็อปปิ้ง 🛒',
                health: 'สุขภาพ 💪',
                study: 'เรียน 📚',
                recurring: 'งานทำซ้ำ 🔄'
            };
            
            if (filtered.length === 0) {
                sections.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">📭</div>
                        <div class="empty-state-text">ไม่มีงานในหมวดนี้</div>
                    </div>
                `;
            } else {
                const active = filtered.filter(t => !t.completed);
                const completed = filtered.filter(t => t.completed);
                
                if (active.length > 0) {
                    sections.appendChild(createSection(titles[type] || 'งาน', active, type === 'overdue' ? '⚠️' : '📋'));
                }
                
                if (completed.length > 0) {
                    sections.appendChild(createSection('เสร็จแล้ว', completed, '✅'));
                }
            }
        }

        function updateSidebarCounts() {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayStr = toDateKey(today);
            const weekLater = new Date(today);
            weekLater.setDate(weekLater.getDate() + 7);
            const weekLaterStr = toDateKey(weekLater);
            
            // Total
            document.getElementById('sidebarTotalTodos').textContent = todos.filter(t => !t.completed).length;
            
            // Today
            document.getElementById('sidebarTodayTodos').textContent = 
                todos.filter(t => t.dueDate === todayStr && !t.completed).length;
            
            // Upcoming
            document.getElementById('sidebarUpcomingTodos').textContent = 
                todos.filter(t => t.dueDate > todayStr && t.dueDate <= weekLaterStr && !t.completed).length;
            
            // Overdue
            document.getElementById('sidebarOverdueTodos').textContent = 
                todos.filter(t => t.dueDate && t.dueDate < todayStr && !t.completed).length;
            
            // Recurring
            document.getElementById('sidebarRecurringTodos').textContent = 
                todos.filter(t => t.recurring && !t.parentId).length;
            
            // Categories
            document.getElementById('sidebarWorkTodos').textContent = 
                todos.filter(t => t.category === 'work' && !t.completed).length;
            document.getElementById('sidebarPersonalTodos').textContent = 
                todos.filter(t => t.category === 'personal' && !t.completed).length;
            document.getElementById('sidebarShoppingTodos').textContent = 
                todos.filter(t => t.category === 'shopping' && !t.completed).length;
            document.getElementById('sidebarHealthTodos').textContent = 
                todos.filter(t => t.category === 'health' && !t.completed).length;
            document.getElementById('sidebarStudyTodos').textContent = 
                todos.filter(t => t.category === 'study' && !t.completed).length;
            
            // Custom categories
            customCategories.forEach(cat => {
                const badge = document.getElementById(`sidebar${cat.key}Todos`);
                if (badge) {
                    badge.textContent = todos.filter(t => t.category === cat.key && !t.completed).length;
                }
            });
            
            // Completed
            document.getElementById('sidebarCompletedTodos').textContent = 
                todos.filter(t => t.completed).length;
        }

        // Add Todo
        function addTodo() {
             // Deprecated: used openAddTodoModal
        }

        function canManageTodosNow() {
            if (!currentUser) return false;
            if (currentUser.role === 'admin' && viewingUser === 'all') return false;
            if (currentUser.role === 'admin') return true;
            const perms = currentUser.permissions || {};
            return typeof perms.manage_todo === 'boolean' ? perms.manage_todo : true;
        }

        function canUseBranchVisitNow() {
            if (!currentUser) return false;
            if (currentUser.role === 'admin' && viewingUser === 'all') return false;
            if (currentUser.role === 'admin') return true;
            const perms = currentUser.permissions || {};
            return typeof perms.branch_visit === 'boolean' ? perms.branch_visit : true;
        }

        function canExportNow() {
            if (!currentUser) return false;
            if (currentUser.role === 'admin') return true;
            const perms = currentUser.permissions || {};
            return typeof perms.export_data === 'boolean' ? perms.export_data : false;
        }

        // Toggle Todo
        function toggleTodo(id) {
            if (!canManageTodosNow()) {
                showToast('ไม่มีสิทธิ์จัดการงาน', 'error');
                return;
            }
            const todo = todos.find(t => t.id === id);
            if (todo) {
                todo.completed = !todo.completed;
                saveTodos();
                refreshAllViews();
                if (todo.completed && discordWebhookUrl) {
                    const owner = todo.assignedTo || (currentUser ? currentUser.username : '');
                    sendDiscordCompletionNotification(todo, owner);
                }
            }
        }

        // Delete Todo
        function deleteTodo(id) {
            if (!canManageTodosNow()) {
                showToast('ไม่มีสิทธิ์จัดการงาน', 'error');
                return;
            }
            const todo = todos.find(t => t.id === id);
            if (!todo) return;

            const isRecurringParent = !!(todo.recurring && !todo.parentId);
            const isRecurringInstance = !!todo.parentId;

            if (isRecurringParent || isRecurringInstance) {
                openDeleteRecurringModal(id);
                return;
            }

            if (confirm('ต้องการลบงานนี้?')) {
                todos = todos.filter(t => t.id !== id);
                saveTodos();
                refreshAllViews();
            }
        }

        // Add Todo Modal Functions
        let addSelectedBranches = [];
        let addSelectedAssignees = [];
        let addTodoSelectedWeekdays = [];

        function openAddTodoModal() {
            if (!canManageTodosNow()) {
                showToast('ไม่มีสิทธิ์จัดการงาน', 'error');
                return;
            }
            // Reset form
            document.getElementById('addTodoText').value = '';
            document.getElementById('addTodoPriority').value = 'medium';
            document.getElementById('addTodoDate').value = getTodayDateString();
            document.getElementById('addTodoTimeStart').value = '';
            document.getElementById('addTodoTimeEnd').value = '';
            const notifyEnabledEl = document.getElementById('addTodoNotifyEnabled');
            const notifyMinutesEl = document.getElementById('addTodoNotifyMinutes');
            if (notifyEnabledEl) notifyEnabledEl.checked = false;
            if (notifyMinutesEl) notifyMinutesEl.value = 10;
            toggleAddTodoNotify();
            addSelectedBranches = [];

            const recurringCheckbox = document.getElementById('addTodoRecurringCheckbox');
            const recurringOptions = document.getElementById('addTodoRecurringOptions');
            if (recurringCheckbox && recurringOptions) {
                recurringCheckbox.checked = false;
                recurringOptions.classList.remove('show');
            }
            const dueDateGroup = document.getElementById('addTodoDateGroup');
            if (dueDateGroup) dueDateGroup.style.display = '';

            addTodoSelectedWeekdays = [];
            document.querySelectorAll('.add-weekday-btn').forEach(btn => btn.classList.remove('selected'));

            const addRecurringStart = document.getElementById('addTodoRecurringStartDate');
            const addRecurringEnd = document.getElementById('addTodoRecurringEndDate');
            const addRecurringType = document.getElementById('addTodoRecurringType');
            const addRecurringInterval = document.getElementById('addTodoRecurringInterval');
            if (addRecurringStart) addRecurringStart.value = document.getElementById('addTodoDate').value;
            if (addRecurringEnd) addRecurringEnd.value = '';
            if (addRecurringType) addRecurringType.value = 'daily';
            if (addRecurringInterval) addRecurringInterval.value = 1;
            updateAddTodoRecurringConfig();

            const addCreatorGroup = document.getElementById('addTodoCreatorGroup');
            const addCreatorSelect = document.getElementById('addTodoCreatedBy');
            if (addCreatorGroup && addCreatorSelect) {
                if (currentUser && currentUser.role === 'admin') {
                    addCreatorGroup.style.display = 'block';
                    addCreatorSelect.innerHTML = '';
                    users.forEach(u => {
                        const option = document.createElement('option');
                        option.value = u.username;
                        option.textContent = u.username;
                        addCreatorSelect.appendChild(option);
                    });
                    addCreatorSelect.value = currentUser.username;
                } else {
                    addCreatorGroup.style.display = 'none';
                    addCreatorSelect.innerHTML = '';
                }
            }

            const addAssignGroup = document.getElementById('addTodoAssignGroup');
            const addAssignGrid = document.getElementById('addTodoAssignedToGrid');
            const addAssignSummary = document.getElementById('addTodoAssignedToSummary');
            if (addAssignGroup && addAssignGrid) {
                if (currentUser && currentUser.role === 'admin') {
                    addAssignGroup.style.display = 'block';
                    const preferred = viewingUser && viewingUser !== 'all' ? viewingUser : currentUser.username;
                    addSelectedAssignees = preferred ? [preferred] : [];
                    renderAddTodoAssignees();
                } else {
                    addAssignGroup.style.display = 'none';
                    addAssignGrid.innerHTML = '';
                    addSelectedAssignees = [];
                    if (addAssignSummary) addAssignSummary.textContent = '';
                }
            }

            // Populate Category
            const categorySelect = document.getElementById('addTodoCategory');
            categorySelect.innerHTML = '';
            
            // Get edited default categories and hidden categories
            const defaultCategoryEdits = JSON.parse(localStorage.getItem('defaultCategoryEdits')) || {};
            const hiddenCategories = JSON.parse(localStorage.getItem('hiddenCategories')) || [];
            
            // Default Categories
            const defaultCategories = [
                { key: 'work', icon: '💼', name: 'งาน' },
                { key: 'personal', icon: '👤', name: 'ส่วนตัว' },
                { key: 'shopping', icon: '🛒', name: 'ช็อปปิ้ง' },
                { key: 'health', icon: '💪', name: 'สุขภาพ' },
                { key: 'study', icon: '📚', name: 'เรียน' }
            ];
            
            defaultCategories.forEach(cat => {
                if (hiddenCategories.includes(cat.key)) return; // Skip if hidden

                const option = document.createElement('option');
                option.value = cat.key;
                
                // Use edited values if available
                if (defaultCategoryEdits[cat.key]) {
                    option.textContent = `${defaultCategoryEdits[cat.key].icon} ${defaultCategoryEdits[cat.key].name}`;
                } else {
                    option.textContent = `${cat.icon} ${cat.name}`;
                }
                categorySelect.appendChild(option);
            });
            
            // Custom Categories
            customCategories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.key;
                option.textContent = `${cat.icon} ${cat.name}`;
                categorySelect.appendChild(option);
            });

            const addBranchGroup = document.getElementById('addBranchGroup');
            const addGrid = document.getElementById('addBranchGrid');
            if (currentUser && currentUser.role === 'admin') {
                if (addBranchGroup) addBranchGroup.style.display = '';
                if (addGrid) {
                    addGrid.innerHTML = '';
                    const allBranches = [...defaultBranches, ...customBranches];
                    allBranches.forEach(branch => {
                        const option = document.createElement('div');
                        option.className = 'branch-option';
                        option.onclick = () => toggleAddBranch(branch);
                        option.innerHTML = `
                            <input type="checkbox" id="add-branch-${branch}" value="${branch}">
                            <label for="add-branch-${branch}">${branch}</label>
                        `;
                        addGrid.appendChild(option);
                    });
                }
            } else {
                if (addBranchGroup) addBranchGroup.style.display = 'none';
                if (addGrid) addGrid.innerHTML = '';
                addSelectedBranches = [];
            }

            document.getElementById('addTodoModal').classList.add('active');
        }

        function toggleAddTodoRecurringOptions() {
            const checkbox = document.getElementById('addTodoRecurringCheckbox');
            const options = document.getElementById('addTodoRecurringOptions');
            if (!checkbox || !options) return;

            checkbox.checked = !checkbox.checked;
            if (checkbox.checked) {
                options.classList.add('show');
                const dueDateGroup = document.getElementById('addTodoDateGroup');
                if (dueDateGroup) dueDateGroup.style.display = 'none';

                const dueDate = document.getElementById('addTodoDate');
                const startEl = document.getElementById('addTodoRecurringStartDate');
                if (startEl && dueDate && dueDate.value && !startEl.value) startEl.value = dueDate.value;
                updateAddTodoRecurringConfig();
            } else {
                options.classList.remove('show');
                const dueDateGroup = document.getElementById('addTodoDateGroup');
                if (dueDateGroup) dueDateGroup.style.display = '';
            }
        }

        function updateAddTodoRecurringConfig() {
            const typeEl = document.getElementById('addTodoRecurringType');
            const weekdayField = document.getElementById('addTodoWeekdayField');
            const intervalField = document.getElementById('addTodoIntervalField');
            const monthlyDayField = document.getElementById('addTodoMonthlyDayField');
            if (!typeEl || !weekdayField || !intervalField) return;

            const type = typeEl.value;

            addTodoSelectedWeekdays = [];
            document.querySelectorAll('.add-weekday-btn').forEach(btn => btn.classList.remove('selected'));

            if (type === 'custom') {
                weekdayField.style.display = 'block';
                intervalField.style.display = 'block';
                if (monthlyDayField) monthlyDayField.style.display = 'none';
            } else if (type === 'weekly') {
                weekdayField.style.display = 'block';
                intervalField.style.display = 'block';
                if (monthlyDayField) monthlyDayField.style.display = 'none';
            } else if (type === 'monthly') {
                weekdayField.style.display = 'none';
                intervalField.style.display = 'block';
                if (monthlyDayField) {
                    monthlyDayField.style.display = 'block';
                    const startEl = document.getElementById('addTodoRecurringStartDate');
                    const startDate = parseDateKeyLocal(startEl ? startEl.value : '');
                    const day = startDate ? String(startDate.getDate()) : '1';
                    const daySelect = document.getElementById('addTodoRecurringMonthlyDay');
                    if (daySelect) daySelect.value = day;
                }
            } else if (type === 'weekdays') {
                weekdayField.style.display = 'none';
                intervalField.style.display = 'none';
                if (monthlyDayField) monthlyDayField.style.display = 'none';
                addTodoSelectedWeekdays = [1, 2, 3, 4, 5];
            } else if (type === 'weekends') {
                weekdayField.style.display = 'none';
                intervalField.style.display = 'none';
                if (monthlyDayField) monthlyDayField.style.display = 'none';
                addTodoSelectedWeekdays = [0, 6];
            } else {
                weekdayField.style.display = 'none';
                intervalField.style.display = 'block';
                if (monthlyDayField) monthlyDayField.style.display = 'none';
            }

            updateAddTodoRecurringPreview();
        }

        function toggleAddTodoWeekday(day) {
            const index = addTodoSelectedWeekdays.indexOf(day);
            const btn = document.querySelector(`.add-weekday-btn[data-day="${day}"]`);
            if (!btn) return;

            if (index > -1) {
                addTodoSelectedWeekdays.splice(index, 1);
                btn.classList.remove('selected');
            } else {
                addTodoSelectedWeekdays.push(day);
                btn.classList.add('selected');
            }
            updateAddTodoRecurringPreview();
        }

        function updateAddTodoRecurringPreview() {
            const typeEl = document.getElementById('addTodoRecurringType');
            const intervalEl = document.getElementById('addTodoRecurringInterval');
            const previewText = document.getElementById('addTodoRecurringPreviewText');
            if (!typeEl || !intervalEl || !previewText) return;

            const type = typeEl.value;
            const interval = parseInt(intervalEl.value) || 1;
            const dayNames = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

            let text = '';
            switch(type) {
                case 'daily':
                    text = interval === 1 ? 'งานนี้จะทำซ้ำทุกวัน' : `งานนี้จะทำซ้ำทุก ${interval} วัน`;
                    break;
                case 'weekly':
                    if (addTodoSelectedWeekdays.length > 0) {
                        const days = [...addTodoSelectedWeekdays].sort().map(d => dayNames[d]).join(', ');
                        text = interval === 1 ?
                            `งานนี้จะทำซ้ำทุกสัปดาห์ในวัน: ${days}` :
                            `งานนี้จะทำซ้ำทุก ${interval} สัปดาห์ในวัน: ${days}`;
                    } else {
                        text = 'กรุณาเลือกวันที่ต้องการ';
                    }
                    break;
                case 'monthly':
                    {
                        const md = document.getElementById('addTodoRecurringMonthlyDay');
                        const v = md ? md.value : '';
                        const dayText = v === 'last' ? 'สิ้นเดือน' : `วันที่ ${v || '1'}`;
                        text = interval === 1 ? `งานนี้จะทำซ้ำทุกเดือน (${dayText})` : `งานนี้จะทำซ้ำทุก ${interval} เดือน (${dayText})`;
                    }
                    break;
                case 'weekdays':
                    text = 'งานนี้จะทำซ้ำทุกวันจันทร์-ศุกร์';
                    break;
                case 'weekends':
                    text = 'งานนี้จะทำซ้ำทุกวันเสาร์-อาทิตย์';
                    break;
                case 'custom':
                    if (addTodoSelectedWeekdays.length > 0) {
                        const days = [...addTodoSelectedWeekdays].sort().map(d => dayNames[d]).join(', ');
                        text = `งานนี้จะทำซ้ำในวัน: ${days}`;
                    } else {
                        text = 'กรุณาเลือกวันที่ต้องการ';
                    }
                    break;
            }

            previewText.textContent = text;
        }

        function toggleAddBranch(branchCode) {
            event.stopPropagation();
            const checkbox = document.getElementById(`add-branch-${branchCode}`);
            checkbox.checked = !checkbox.checked;
            
            const option = checkbox.closest('.branch-option');
            if (checkbox.checked) {
                option.classList.add('selected');
                if (!addSelectedBranches.includes(branchCode)) {
                    addSelectedBranches.push(branchCode);
                }
            } else {
                option.classList.remove('selected');
                addSelectedBranches = addSelectedBranches.filter(b => b !== branchCode);
            }
        }

        function getAddAssigneeOptionId(username) {
            return `add-assignee-${String(username || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        }

        function renderAddTodoAssignees() {
            const grid = document.getElementById('addTodoAssignedToGrid');
            const summary = document.getElementById('addTodoAssignedToSummary');
            if (!grid) return;
            grid.innerHTML = '';

            const selectedSet = new Set((Array.isArray(addSelectedAssignees) ? addSelectedAssignees : []).filter(Boolean));
            const sorted = Array.isArray(users) ? [...users].filter(u => u && u.username) : [];
            sorted.sort((a, b) => String(a.username).localeCompare(String(b.username), 'th'));

            sorted.forEach(u => {
                const username = u.username;
                const isSelected = selectedSet.has(username);
                const option = document.createElement('div');
                option.className = 'branch-option' + (isSelected ? ' selected' : '');
                option.onclick = () => toggleAddAssignee(username);
                const id = getAddAssigneeOptionId(username);
                const label = u.displayName ? `${u.displayName} (${u.username})` : u.username;
                option.innerHTML = `
                    <input type="checkbox" id="${id}" value="${username}" ${isSelected ? 'checked' : ''}>
                    <label for="${id}">${label}</label>
                `;
                grid.appendChild(option);
            });

            if (summary) {
                const names = Array.from(selectedSet).map(u => getUserDisplayName(u)).join(', ');
                summary.textContent = selectedSet.size > 0 ? `เลือกแล้ว: ${names}` : 'ยังไม่ได้เลือกผู้รับงาน';
            }
        }

        function toggleAddAssignee(username) {
            event.stopPropagation();
            const u = String(username || '');
            if (!u) return;
            const idx = addSelectedAssignees.indexOf(u);
            if (idx > -1) addSelectedAssignees.splice(idx, 1);
            else addSelectedAssignees.push(u);

            const id = getAddAssigneeOptionId(u);
            const checkbox = document.getElementById(id);
            if (checkbox) checkbox.checked = addSelectedAssignees.includes(u);
            const option = checkbox ? checkbox.closest('.branch-option') : null;
            if (option) option.classList.toggle('selected', checkbox.checked);
            renderAddTodoAssignees();
        }

        async function saveNewTodo() {
            if (!canManageTodosNow()) {
                showToast('ไม่มีสิทธิ์จัดการงาน', 'error');
                return;
            }
            const text = document.getElementById('addTodoText').value.trim();
            if (!text) {
                showToast('กรุณาใส่ชื่องาน', 'error');
                return;
            }

            const priority = document.getElementById('addTodoPriority').value;
            const category = document.getElementById('addTodoCategory').value;
            const dueDate = document.getElementById('addTodoDate').value;
            const timeStart = document.getElementById('addTodoTimeStart').value;
            const timeEnd = document.getElementById('addTodoTimeEnd').value;
            const notifyEnabled = !!(document.getElementById('addTodoNotifyEnabled') && document.getElementById('addTodoNotifyEnabled').checked);
            const notifyMinutesRaw = document.getElementById('addTodoNotifyMinutes') ? document.getElementById('addTodoNotifyMinutes').value : '';
            const notifyMinutesBefore = Math.max(0, Math.min(1440, parseInt(notifyMinutesRaw) || 0));

            if (notifyEnabled && !timeStart) {
                showToast('กรุณาเลือกเวลาเริ่ม เพื่อใช้การแจ้งเตือน', 'error');
                return;
            }

            const createdBy = (() => {
                if (currentUser && currentUser.role === 'admin') {
                    const select = document.getElementById('addTodoCreatedBy');
                    return select && select.value ? select.value : currentUser.username;
                }
                return currentUser ? currentUser.username : '';
            })();

            const recurringEnabled = !!(document.getElementById('addTodoRecurringCheckbox') && document.getElementById('addTodoRecurringCheckbox').checked);

            const targetUsernames = (() => {
                if (!(currentUser && currentUser.role === 'admin')) {
                    return currentUser ? [currentUser.username] : [];
                }
                const selected = Array.isArray(addSelectedAssignees) ? addSelectedAssignees.filter(Boolean) : [];
                if (selected.length > 0) return Array.from(new Set(selected));
                return [viewingUser && viewingUser !== 'all' ? viewingUser : currentUser.username];
            })();
            if (targetUsernames.length === 0) return;

            const currentOwner = currentUser && currentUser.role === 'admin' && viewingUser ? viewingUser : (currentUser ? currentUser.username : '');
            const makeId = () => Date.now() + Math.random();

            const lists = new Map();
            await Promise.all(targetUsernames.map(async (u) => {
                const key = `${u}_todos`;
                const listRef = u === currentOwner ? todos : (await getAppItem(key));
                lists.set(u, Array.isArray(listRef) ? listRef : []);
            }));

            if (recurringEnabled) {
                const typeEl = document.getElementById('addTodoRecurringType');
                const intervalEl = document.getElementById('addTodoRecurringInterval');
                const endEl = document.getElementById('addTodoRecurringEndDate');
                const startEl = document.getElementById('addTodoRecurringStartDate');
                const type = typeEl ? typeEl.value : 'daily';
                const interval = intervalEl ? (parseInt(intervalEl.value) || 1) : 1;
                const startDateStr = (startEl && startEl.value ? startEl.value : '') || dueDate || getTodayDateString();
                const endDateStrRaw = endEl ? endEl.value : '';

                if ((type === 'weekly' || type === 'custom') && (!Array.isArray(addTodoSelectedWeekdays) || addTodoSelectedWeekdays.length === 0)) {
                    showToast('กรุณาเลือกวันที่ต้องการทำซ้ำ', 'error');
                    return;
                }

                const startDate = parseDateKeyLocal(startDateStr);
                if (!startDate) {
                    showToast('กรุณาเลือกวันที่เริ่มต้นที่ถูกต้อง', 'error');
                    return;
                }

                const shouldCreateStartInstance = shouldGenerateForDate(startDate, {
                    type,
                    interval,
                    startDate: startDateStr,
                    endDate: endDateStrRaw || null,
                    monthlyDay: type === 'monthly' ? (document.getElementById('addTodoRecurringMonthlyDay') ? document.getElementById('addTodoRecurringMonthlyDay').value : undefined) : undefined,
                    weekdays: (type === 'weekly' || type === 'custom') ? [...addTodoSelectedWeekdays].sort() : undefined
                });

                for (const u of targetUsernames) {
                    const targetList = lists.get(u) || [];
                    const baseTask = {
                        text: text,
                        priority: priority,
                        category: category,
                        timeStart: timeStart || null,
                        timeEnd: timeEnd || null,
                        notifyEnabled,
                        notifyMinutesBefore,
                        branches: currentUser && currentUser.role === 'admin' ? [...addSelectedBranches] : [],
                        createdBy,
                        assignedTo: u,
                        createdAt: new Date().toISOString()
                    };

                    const recurring = {
                        type,
                        interval,
                        startDate: startDateStr,
                        endDate: endDateStrRaw || null,
                        monthlyDay: type === 'monthly' ? (document.getElementById('addTodoRecurringMonthlyDay') ? document.getElementById('addTodoRecurringMonthlyDay').value : undefined) : undefined,
                        weekdays: (type === 'weekly' || type === 'custom') ? [...addTodoSelectedWeekdays].sort() : undefined,
                        lastGenerated: null
                    };

                    const parentId = makeId();
                    const parent = {
                        id: parentId,
                        ...baseTask,
                        dueDate: null,
                        completed: false,
                        recurring
                    };
                    targetList.unshift(parent);

                    if (shouldCreateStartInstance) {
                        const existingInstance = targetList.find(t => t && t.parentId === parentId && t.dueDate === startDateStr);
                        if (!existingInstance) {
                            const instance = {
                                id: makeId(),
                                ...baseTask,
                                dueDate: startDateStr,
                                completed: false,
                                parentId
                            };
                            delete instance.recurring;
                            targetList.unshift(instance);
                            parent.recurring.lastGenerated = startDateStr;
                        }
                    }

                    lists.set(u, targetList);
                }
            } else {
                for (const u of targetUsernames) {
                    const targetList = lists.get(u) || [];
                    const baseTask = {
                        text: text,
                        priority: priority,
                        category: category,
                        timeStart: timeStart || null,
                        timeEnd: timeEnd || null,
                        notifyEnabled,
                        notifyMinutesBefore,
                        branches: currentUser && currentUser.role === 'admin' ? [...addSelectedBranches] : [],
                        createdBy,
                        assignedTo: currentUser && currentUser.role === 'admin' ? u : undefined,
                        createdAt: new Date().toISOString()
                    };
                    targetList.unshift({
                        id: makeId(),
                        ...baseTask,
                        dueDate: dueDate || null,
                        completed: false
                    });
                    lists.set(u, targetList);
                }
            }

            await Promise.all(targetUsernames.map(async (u) => {
                const key = `${u}_todos`;
                const list = lists.get(u) || [];
                await setAppItem(key, list);
                if (u === currentOwner) todos = list;
            }));
            refreshAllViews();
            
            closeAddTodoModal();
            const names = targetUsernames.map(u => getUserDisplayName(u)).join(', ');
            showToast(`✅ เพิ่มงานให้ ${names}`);
            const discordAssignees = targetUsernames.filter(u => {
                const u_ = users.find(x => x.username === u);
                return u_ && u_.role !== 'admin';
            });
            if (discordAssignees.length > 0) {
                sendDiscordNotification(text, discordAssignees, dueDate, timeStart, priority, createdBy);
            }
        }

        function toggleAddTodoNotify() {
            const enabledEl = document.getElementById('addTodoNotifyEnabled');
            const minutesEl = document.getElementById('addTodoNotifyMinutes');
            if (!enabledEl || !minutesEl) return;
            minutesEl.disabled = !enabledEl.checked;
            minutesEl.style.opacity = enabledEl.checked ? '' : '0.6';
        }

        function closeAddTodoModal(event) {
            if (!event || event.target.id === 'addTodoModal' || event.target.closest('.close-btn') || event.target.classList.contains('btn-secondary')) {
                document.getElementById('addTodoModal').classList.remove('active');
            }
        }

        let pendingDeleteRecurringTodoId = null;

        function openDeleteRecurringModal(todoId) {
            pendingDeleteRecurringTodoId = todoId;
            const modal = document.getElementById('deleteRecurringModal');
            if (modal) modal.classList.add('active');
        }

        function closeDeleteRecurringModal(event) {
            if (!event || event.target.id === 'deleteRecurringModal' || event.target.closest('.close-btn') || event.target.classList.contains('btn-secondary')) {
                const modal = document.getElementById('deleteRecurringModal');
                if (modal) modal.classList.remove('active');
                pendingDeleteRecurringTodoId = null;
            }
        }

        function confirmDeleteRecurring(mode) {
            if (!pendingDeleteRecurringTodoId) return;
            const todo = todos.find(t => t.id === pendingDeleteRecurringTodoId);
            if (!todo) {
                closeDeleteRecurringModal();
                return;
            }

            const rootId = todo.parentId ? todo.parentId : todo.id;
            if (mode === 'series') {
                todos = todos.filter(t => t.id !== rootId && t.parentId !== rootId);
                saveTodos();
                refreshAllViews();
                closeDeleteRecurringModal();
                showToast('🗑️ ลบทั้งงานที่ซ้ำแล้ว');
                return;
            }

            todos = todos.filter(t => t.id !== todo.id);
            saveTodos();
            refreshAllViews();
            closeDeleteRecurringModal();
            showToast('🗓️ ลบวันเดียวแล้ว');
        }

        // Edit Todo
        let currentEditId = null;
        let editSelectedBranches = [];

        function editTodo(id) {
            if (!canManageTodosNow()) {
                showToast('ไม่มีสิทธิ์จัดการงาน', 'error');
                return;
            }
            const todo = todos.find(t => t.id === id);
            if (!todo) return;

            currentEditId = id;
            editSelectedBranches = todo.branches ? [...todo.branches] : [];

            const editCreatorGroup = document.getElementById('editTodoCreatorGroup');
            const editCreatorSelect = document.getElementById('editTodoCreatedBy');
            if (editCreatorGroup && editCreatorSelect) {
                if (currentUser && currentUser.role === 'admin') {
                    editCreatorGroup.style.display = 'block';
                    editCreatorSelect.innerHTML = '';
                    users.forEach(u => {
                        const option = document.createElement('option');
                        option.value = u.username;
                        option.textContent = u.username;
                        editCreatorSelect.appendChild(option);
                    });
                    editCreatorSelect.value = todo.createdBy || currentUser.username;
                } else {
                    editCreatorGroup.style.display = 'none';
                    editCreatorSelect.innerHTML = '';
                }
            }

            // Populate form
            document.getElementById('editTodoText').value = todo.text;
            document.getElementById('editTodoPriority').value = todo.priority;
            document.getElementById('editTodoCategory').value = todo.category;
            document.getElementById('editTodoDate').value = todo.dueDate || '';
            document.getElementById('editTodoTimeStart').value = todo.timeStart || '';
            document.getElementById('editTodoTimeEnd').value = todo.timeEnd || '';
            const editNotifyEnabled = document.getElementById('editTodoNotifyEnabled');
            const editNotifyMinutes = document.getElementById('editTodoNotifyMinutes');
            if (editNotifyEnabled) editNotifyEnabled.checked = !!todo.notifyEnabled;
            if (editNotifyMinutes) editNotifyMinutes.value = typeof todo.notifyMinutesBefore === 'number' ? todo.notifyMinutesBefore : 10;
            toggleEditTodoNotify();

            const editBranchGroup = document.getElementById('editBranchGroup');
            const editGrid = document.getElementById('editBranchGrid');
            if (currentUser && currentUser.role === 'admin') {
                if (editBranchGroup) editBranchGroup.style.display = '';
                if (editGrid) {
                    editGrid.innerHTML = '';
                    const allBranches = [...defaultBranches, ...customBranches];
                    allBranches.forEach(branch => {
                        const isSelected = editSelectedBranches.includes(branch);
                        const option = document.createElement('div');
                        option.className = 'branch-option' + (isSelected ? ' selected' : '');
                        option.onclick = () => toggleEditBranch(branch);
                        option.innerHTML = `
                            <input type="checkbox" id="edit-branch-${branch}" value="${branch}" ${isSelected ? 'checked' : ''}>
                            <label for="edit-branch-${branch}">${branch}</label>
                        `;
                        editGrid.appendChild(option);
                    });
                }
            } else {
                if (editBranchGroup) editBranchGroup.style.display = 'none';
                if (editGrid) editGrid.innerHTML = '';
            }

            // Show modal
            document.getElementById('editModal').classList.add('active');
        }

        function toggleEditTodoNotify() {
            const enabledEl = document.getElementById('editTodoNotifyEnabled');
            const minutesEl = document.getElementById('editTodoNotifyMinutes');
            if (!enabledEl || !minutesEl) return;
            minutesEl.disabled = !enabledEl.checked;
            minutesEl.style.opacity = enabledEl.checked ? '' : '0.6';
        }

        function toggleEditBranch(branchCode) {
            event.stopPropagation();
            const checkbox = document.getElementById(`edit-branch-${branchCode}`);
            checkbox.checked = !checkbox.checked;
            
            const option = checkbox.closest('.branch-option');
            if (checkbox.checked) {
                option.classList.add('selected');
                if (!editSelectedBranches.includes(branchCode)) {
                    editSelectedBranches.push(branchCode);
                }
            } else {
                option.classList.remove('selected');
                editSelectedBranches = editSelectedBranches.filter(b => b !== branchCode);
            }
        }

        function saveEditedTodo() {
            if (!canManageTodosNow()) {
                showToast('ไม่มีสิทธิ์จัดการงาน', 'error');
                return;
            }
            if (!currentEditId) return;

            const todo = todos.find(t => t.id === currentEditId);
            if (!todo) return;

            // Update todo
            todo.text = document.getElementById('editTodoText').value.trim();
            todo.priority = document.getElementById('editTodoPriority').value;
            todo.category = document.getElementById('editTodoCategory').value;
            todo.dueDate = document.getElementById('editTodoDate').value;
            todo.timeStart = document.getElementById('editTodoTimeStart').value;
            todo.timeEnd = document.getElementById('editTodoTimeEnd').value;
            todo.notifyEnabled = !!(document.getElementById('editTodoNotifyEnabled') && document.getElementById('editTodoNotifyEnabled').checked);
            const notifyMinutesRaw = document.getElementById('editTodoNotifyMinutes') ? document.getElementById('editTodoNotifyMinutes').value : '';
            todo.notifyMinutesBefore = Math.max(0, Math.min(1440, parseInt(notifyMinutesRaw) || 0));
            if (currentUser && currentUser.role === 'admin') {
                todo.branches = [...editSelectedBranches];
            }
            if (currentUser && currentUser.role === 'admin') {
                const select = document.getElementById('editTodoCreatedBy');
                if (select && select.value) {
                    todo.createdBy = select.value;
                }
            } else if (!todo.createdBy && currentUser) {
                todo.createdBy = currentUser.username;
            }

            if (todo.notifyEnabled && !todo.timeStart) {
                showToast('กรุณาเลือกเวลาเริ่ม เพื่อใช้การแจ้งเตือน', 'error');
                return;
            }

            if (!todo.text) {
                showToast('กรุณาใส่ชื่องาน', 'error');
                return;
            }

            saveTodos();
            refreshAllViews();

            closeEditModal();
            showToast('✅ แก้ไขงานสำเร็จ!');
        }

        function closeEditModal(event) {
            if (!event || event.target.id === 'editModal') {
                document.getElementById('editModal').classList.remove('active');
                currentEditId = null;
                editSelectedBranches = [];
            }
        }

        // Filter Todos
        function filterTodos(filter) {
            currentFilter = filter;
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Only add 'active' class if it's a button (not select)
            if (event.target.classList.contains('filter-btn')) {
                event.target.classList.add('active');
                // Reset select if button is clicked
                document.getElementById('branchFilter').value = '';
            } else if (event.target.id === 'branchFilter') {
                 // Remove active from all buttons if select is used
                 // (Already done by removing from all)
            }
            
            renderTodos();
        }

        // Search Todos
        document.getElementById('searchInput').addEventListener('input', function(e) {
            renderTodos(e.target.value);
        });

        // Select Category
        function selectCategory(category) {
            currentCategory = category;
            document.querySelectorAll('.category-tag').forEach(tag => {
                tag.classList.remove('active');
            });
            event.target.classList.add('active');
        }

        // Render Todos
        function renderTodos(searchQuery = '') {
            let filtered = [...todos];
            filtered = filtered.filter(t => !(t && t.recurring && !t.parentId));

            // Apply search
            if (searchQuery) {
                filtered = filtered.filter(todo => 
                    todo.text.toLowerCase().includes(searchQuery.toLowerCase())
                );
            }

            // Apply filter
            if (currentFilter === 'active') {
                filtered = filtered.filter(t => !t.completed);
            } else if (currentFilter === 'completed') {
                filtered = filtered.filter(t => t.completed);
            } else if (['high', 'medium', 'low'].includes(currentFilter)) {
                filtered = filtered.filter(t => t.priority === currentFilter);
            } else if (currentFilter.startsWith('branch:')) {
                const branch = currentFilter.split(':')[1];
                if (branch) {
                    filtered = filtered.filter(t => t.branches && t.branches.includes(branch));
                }
            }

            // Group by status
            const active = filtered.filter(t => !t.completed);
            const completed = filtered.filter(t => t.completed);

            const sections = document.getElementById('todoSections');
            sections.innerHTML = '';

            // Split active into ตารางงาน (has branches) and งาน (no branches)
            const activeSchedule = active.filter(t => t.branches && t.branches.length > 0);
            const activeTask = active.filter(t => !t.branches || t.branches.length === 0);

            if (active.length > 0 || currentFilter === 'all' || currentFilter === 'active') {
                if (activeSchedule.length > 0) {
                    sections.appendChild(createSection('ตารางงาน', activeSchedule, '🏢'));
                }
                if (activeTask.length > 0) {
                    sections.appendChild(createSection('งานที่ต้องทำ', activeTask, '⏳'));
                }
                if (active.length === 0) {
                    sections.appendChild(createSection('งานที่ต้องทำ', [], '⏳'));
                }
            }

            // Completed Todos Section
            if (completed.length > 0 || currentFilter === 'completed') {
                sections.appendChild(createSection('งานที่เสร็จแล้ว', completed, '✅'));
            }

            // Empty state
            if (filtered.length === 0) {
                sections.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">📭</div>
                        <div class="empty-state-text">ไม่มีงานในรายการ</div>
                        <p style="color: var(--text-secondary);">เพิ่มงานใหม่เพื่อเริ่มต้นใช้งาน</p>
                    </div>
                `;
            }
        }

        // Create Section
        function createSection(title, todos, icon) {
            const section = document.createElement('div');
            section.className = 'section fade-in';

            const header = `
                <div class="section-header">
                    <div class="section-title">
                        <span>${icon}</span>
                        <span>${title}</span>
                        <span class="section-count">${todos.length}</span>
                    </div>
                </div>
            `;

            const list = document.createElement('div');
            list.className = 'todo-list';

            todos.forEach(todo => {
                list.appendChild(createTodoItem(todo));
            });

            section.innerHTML = header;
            section.appendChild(list);

            return section;
        }

        // Create Todo Item
        // Holiday Helper
        function getThaiHoliday(dateStr) {
            // dateStr format: YYYY-MM-DD
            const [year, month, day] = dateStr.split('-').map(Number);
            const holidays = {
                '01-01': 'วันขึ้นปีใหม่',
                '02-14': 'วันวาเลนไทน์',
                '04-06': 'วันจักรี',
                '04-13': 'วันสงกรานต์',
                '04-14': 'วันสงกรานต์',
                '04-15': 'วันสงกรานต์',
                '05-01': 'วันแรงงาน',
                '05-04': 'วันฉัตรมงคล',
                '07-28': 'วันเฉลิมพระชนมพรรษา ร.10',
                '08-12': 'วันแม่แห่งชาติ',
                '10-13': 'วันคล้ายวันสวรรคต ร.9',
                '10-23': 'วันปิยมหาราช',
                '12-05': 'วันพ่อแห่งชาติ',
                '12-10': 'วันรัฐธรรมนูญ',
                '12-31': 'วันสิ้นปี'
            };
            const key = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            return holidays[key] || '';
        }

        function createTodoItem(todo) {
            const item = document.createElement('div');
            item.className = `todo-item ${todo.completed ? 'completed' : ''}`;

            const categoryIcons = {
                work: '💼',
                personal: '👤',
                shopping: '🛒',
                health: '💪',
                study: '📚'
            };

            const isOverdue = todo.dueDate && todo.dueDate < toDateKey(new Date()) && !todo.completed;
            const timeDisplay = todo.timeStart && todo.timeEnd ? 
                `⏰ ${todo.timeStart}-${todo.timeEnd}` : 
                (todo.timeStart ? `⏰ ${todo.timeStart}` : '');
            const isRecurring = todo.recurring ? true : false;
            const recurringText = getRecurringText(todo.recurring);
            const branchDisplay = todo.branches && todo.branches.length > 0 ? 
                todo.branches.map(b => `<span class="branch-badge">🏢 ${b}</span>`).join(' ') : '';

            const isAllView = currentUser && currentUser.role === 'admin' && viewingUser === 'all';
            const canManage = currentUser && (currentUser.role === 'admin'
                ? true
                : (currentUser.permissions && typeof currentUser.permissions.manage_todo === 'boolean'
                    ? currentUser.permissions.manage_todo
                    : true));
            const allowEdit = !!canManage && !isAllView;
            const checkboxOnClick = allowEdit ? `toggleTodo(${todo.id})` : `showToast('ไม่มีสิทธิ์จัดการงาน', 'error')`;
            const checkboxHTML = isAllView ? '' : `
                <div class="checkbox-wrapper">
                    <div class="checkbox ${todo.completed ? 'checked' : ''}" onclick="${checkboxOnClick}"></div>
                </div>
            `;
            const actionsHTML = allowEdit ? `
                <div class="todo-actions">
                    <button class="icon-btn" onclick="editTodo(${todo.id})" title="แก้ไข">✏️</button>
                    <button class="icon-btn delete" onclick="deleteTodo(${todo.id})" title="ลบ">🗑️</button>
                </div>
            ` : `<div class="todo-actions"></div>`;

            item.innerHTML = `
                ${checkboxHTML}
                <div class="todo-content">
                    <div class="todo-text">
                        ${todo.owner ? `<span style="background: #e2e8f0; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 0.8rem; margin-right: 6px;">👤 ${getUserDisplayName(todo.owner)}</span>` : ''}
                        ${isAllView && todo.createdBy && todo.createdBy !== todo.owner ? `<span style="background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 0.8rem; margin-right: 6px;">✍️ ${getUserDisplayName(todo.createdBy)}</span>` : ''}
                        ${todo.icon ? todo.icon + ' ' : ''}${todo.text}
                    </div>
                    <div class="todo-meta">
                        <span class="category-tag ${todo.category}">${getCategoryIcon(todo.category)} ${getCategoryName(todo.category)}</span>
                        <span class="priority-badge priority-${todo.priority}">${getPriorityText(todo.priority)}</span>
                        ${isRecurring ? `<span class="recurring-badge">🔄 ${recurringText}</span>` : ''}
                        ${branchDisplay}
                        ${todo.dueDate ? `<span class="due-date ${isOverdue ? 'overdue' : ''}">📅 ${formatDate(todo.dueDate)} ${timeDisplay}</span>` : ''}
                    </div>
                </div>
                ${actionsHTML}
            `;

            return item;
        }

        // Update Stats
        function updateStats() {
            const total = todos.length;
            const completed = todos.filter(t => t.completed).length;
            const pending = total - completed;
            const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

            document.getElementById('totalTodos').textContent = total;
            document.getElementById('completedTodos').textContent = completed;
            document.getElementById('pendingTodos').textContent = pending;

            // Update progress bar
            const progressBar = document.getElementById('progressBarFill');
            const progressText = document.getElementById('progressPercentage');
            const completedCountEl = document.getElementById('completedCount');
            const totalCountEl = document.getElementById('totalCount');

            progressText.textContent = percentage + '%';
            progressBar.style.width = percentage + '%';
            completedCountEl.textContent = completed;
            totalCountEl.textContent = total;

            // Change color based on percentage
            progressBar.classList.remove('low', 'medium', 'high', 'complete');
            if (percentage === 100) {
                progressBar.classList.add('complete');
            } else if (percentage >= 70) {
                progressBar.classList.add('high');
            } else if (percentage >= 40) {
                progressBar.classList.add('medium');
            } else {
                progressBar.classList.add('low');
            }
        }

        // Helper Functions
        function getCategoryName(category) {
            // Check default category edits
            const defaultCategoryEdits = JSON.parse(localStorage.getItem('defaultCategoryEdits')) || {};
            if (defaultCategoryEdits[category]) {
                return defaultCategoryEdits[category].name;
            }

            const names = {
                work: 'งาน',
                personal: 'ส่วนตัว',
                shopping: 'ช็อปปิ้ง',
                health: 'สุขภาพ',
                study: 'เรียน'
            };
            
            // Check custom categories
            const custom = customCategories.find(c => c.key === category);
            if (custom) return custom.name;
            
            return names[category] || category;
        }

        function getCategoryIcon(category) {
            // Check default category edits
            const defaultCategoryEdits = JSON.parse(localStorage.getItem('defaultCategoryEdits')) || {};
            if (defaultCategoryEdits[category]) {
                return defaultCategoryEdits[category].icon;
            }

            const icons = {
                work: '💼',
                personal: '👤',
                shopping: '🛒',
                health: '💪',
                study: '📚'
            };
            
            // Check custom categories
            const custom = customCategories.find(c => c.key === category);
            if (custom) return custom.icon;
            
            return icons[category] || '📝';
        }

        function getPriorityText(priority) {
            const texts = {
                high: 'สำคัญมาก',
                medium: 'ปานกลาง',
                low: 'สำคัญน้อย'
            };
            return texts[priority] || priority;
        }

        function formatDate(dateString) {
            const date = new Date(dateString);
            const options = { day: 'numeric', month: 'short', year: 'numeric' };
            return date.toLocaleDateString('th-TH', options);
        }

        function setDefaultDate() {
            // Deprecated
        }

        // Clear Completed
        function clearCompleted() {
            if (!canManageTodosNow()) {
                showToast('ไม่มีสิทธิ์จัดการงาน', 'error');
                return;
            }
            const completedCount = todos.filter(t => t.completed).length;
            if (completedCount === 0) {
                alert('ไม่มีงานที่เสร็จแล้วให้ลบ');
                return;
            }

            if (confirm(`ต้องการลบงานที่เสร็จแล้ว ${completedCount} รายการ?`)) {
                todos = todos.filter(t => !t.completed);
                saveTodos();
                renderTodos();
                updateStats();
            }
        }

        // Export/Import Functions
        function toggleExportMenu() {
            if (!canExportNow()) {
                showToast('ไม่มีสิทธิ์ Export', 'error');
                return;
            }
            // Re-implement as a modal or simple action sheet since it's now in sidebar
            // For now, let's create a modal for export/import actions
            let modal = document.getElementById('exportModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'exportModal';
                modal.className = 'edit-modal'; // Reuse edit modal style
                modal.innerHTML = `
                    <div class="edit-modal-content" style="max-width: 300px;">
                        <div class="edit-modal-header">
                            <h3 class="edit-modal-title">📥 นำเข้า/ส่งออก</h3>
                            <button class="close-btn" onclick="document.getElementById('exportModal').classList.remove('active')">✕</button>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 15px;">
                            <button class="btn btn-secondary" onclick="exportToExcel()" style="justify-content: flex-start;">📊 ส่งออก Excel (.xlsx)</button>
                            <button class="btn btn-secondary" onclick="exportToCSV()" style="justify-content: flex-start;">📄 ส่งออก CSV</button>
                            <button class="btn btn-secondary" onclick="exportToJSON()" style="justify-content: flex-start;">💾 ส่งออก JSON</button>
                            <button class="btn btn-primary" onclick="document.getElementById('importFile').click()" style="justify-content: flex-start;">📥 นำเข้า Excel/CSV</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }
            
            modal.classList.add('active');
            
            // Close sidebar on mobile if open
            if (window.innerWidth <= 1024) {
                 const sidebar = document.getElementById('sidebar');
                 if (sidebar.classList.contains('active')) {
                     toggleSidebar();
                 }
            }
        }

        function closeExportMenu(e) {
             // Deprecated
        }

        function exportToExcel() {
            // Prepare data for Excel
            const data = todos.map(todo => ({
                'งาน': todo.text,
                'สถานะ': todo.completed ? 'เสร็จแล้ว' : 'ยังไม่เสร็จ',
                'ความสำคัญ': getPriorityText(todo.priority),
                'หมวดหมู่': getCategoryName(todo.category),
                'สาขา': todo.branches && todo.branches.length > 0 ? todo.branches.join(', ') : '',
                'วันที่': todo.dueDate ? formatDate(todo.dueDate) : '',
                'เวลาเริ่ม': todo.timeStart || '',
                'เวลาสิ้นสุด': todo.timeEnd || '',
                'สร้างเมื่อ': new Date(todo.createdAt).toLocaleString('th-TH')
            }));

            // Create workbook
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(data);

            // Set column widths
            ws['!cols'] = [
                { wch: 40 }, // งาน
                { wch: 12 }, // สถานะ
                { wch: 15 }, // ความสำคัญ
                { wch: 12 }, // หมวดหมู่
                { wch: 20 }, // สาขา
                { wch: 15 }, // วันที่
                { wch: 10 }, // เวลาเริ่ม
                { wch: 10 }, // เวลาสิ้นสุด
                { wch: 20 }  // สร้างเมื่อ
            ];

            // Add worksheet to workbook
            XLSX.utils.book_append_sheet(wb, ws, 'งาน');

            // Add summary sheet
            const summary = [
                { 'รายการ': 'งานทั้งหมด', 'จำนวน': todos.length },
                { 'รายการ': 'เสร็จแล้ว', 'จำนวน': todos.filter(t => t.completed).length },
                { 'รายการ': 'ยังไม่เสร็จ', 'จำนวน': todos.filter(t => !t.completed).length },
                { 'รายการ': 'สำคัญมาก', 'จำนวน': todos.filter(t => t.priority === 'high').length },
                { 'รายการ': 'สำคัญปานกลาง', 'จำนวน': todos.filter(t => t.priority === 'medium').length },
                { 'รายการ': 'สำคัญน้อย', 'จำนวน': todos.filter(t => t.priority === 'low').length }
            ];
            const summaryWs = XLSX.utils.json_to_sheet(summary);
            XLSX.utils.book_append_sheet(wb, summaryWs, 'สรุป');

            // Save file
            const fileName = `ตารางงานคุณชายโดม_${getTodayDateString()}.xlsx`;
            XLSX.writeFile(wb, fileName);

            toggleExportMenu();
            showToast('ส่งออก Excel สำเร็จ! 📊');
        }

        function exportToCSV() {
            const data = todos.map(todo => ({
                'เจ้าของข้อมูล': todo.owner || '',
                'ผู้บันทึกงาน': todo.createdBy || '',
                'งาน': todo.text,
                'สถานะ': todo.completed ? 'เสร็จแล้ว' : 'ยังไม่เสร็จ',
                'ความสำคัญ': getPriorityText(todo.priority),
                'หมวดหมู่': getCategoryName(todo.category),
                'สาขา': todo.branches && todo.branches.length > 0 ? todo.branches.join(', ') : '',
                'วันที่': todo.dueDate || '',
                'เวลาเริ่ม': todo.timeStart || '',
                'เวลาสิ้นสุด': todo.timeEnd || '',
                'สร้างเมื่อ': new Date(todo.createdAt).toLocaleString('th-TH')
            }));

            const ws = XLSX.utils.json_to_sheet(data);
            const csv = XLSX.utils.sheet_to_csv(ws);
            
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            
            link.setAttribute('href', url);
            link.setAttribute('download', `ตารางงานคุณชายโดม_${getTodayDateString()}.csv`);
            link.click();

            toggleExportMenu();
            showToast('ส่งออก CSV สำเร็จ! 📄');
        }

        function exportToJSON() {
            const dataStr = JSON.stringify(todos, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `ตารางงานคุณชายโดม_${getTodayDateString()}.json`;
            link.click();

            toggleExportMenu();
            showToast('ส่งออก JSON สำเร็จ! 💾');
        }

        function importFile(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            
            reader.onload = function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    
                    // Read first sheet
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                    
                    // Convert to todos format
                    let imported = 0;
                    jsonData.forEach(row => {
                        // Handle both Thai and English headers
                        const text = row['งาน'] || row['Task'] || row['text'];
                        if (!text) return;

                        const completed = (row['สถานะ'] || row['Status'] || row['completed']) === 'เสร็จแล้ว' || 
                                        (row['สถานะ'] || row['Status'] || row['completed']) === 'Completed' ||
                                        (row['completed'] === true);
                        
                        const priorityMap = {
                            'สำคัญมาก': 'high',
                            'High': 'high',
                            'สำคัญปานกลาง': 'medium',
                            'Medium': 'medium',
                            'สำคัญน้อย': 'low',
                            'Low': 'low'
                        };
                        const priority = priorityMap[row['ความสำคัญ'] || row['Priority'] || row['priority']] || 'medium';

                        const categoryMap = {
                            'งาน': 'work',
                            'Work': 'work',
                            'ส่วนตัว': 'personal',
                            'Personal': 'personal',
                            'ช็อปปิ้ง': 'shopping',
                            'Shopping': 'shopping',
                            'สุขภาพ': 'health',
                            'Health': 'health',
                            'เรียน': 'study',
                            'Study': 'study'
                        };
                        const category = categoryMap[row['หมวดหมู่'] || row['Category'] || row['category']] || 'personal';

                        // Parse date
                        let dueDate = row['วันที่'] || row['Date'] || row['dueDate'] || '';
                        if (dueDate && typeof dueDate === 'number') {
                            // Excel date serial number
                            const excelDate = XLSX.SSF.parse_date_code(dueDate);
                            dueDate = `${excelDate.y}-${String(excelDate.m).padStart(2, '0')}-${String(excelDate.d).padStart(2, '0')}`;
                        } else if (dueDate) {
                            // Try to parse string date
                            const parsedDate = new Date(dueDate);
                            if (!isNaN(parsedDate)) {
                                dueDate = toDateKey(parsedDate);
                            }
                        }

                        const todo = {
                            id: Date.now() + imported,
                            text: text,
                            completed: completed,
                            priority: priority,
                            category: category,
                            dueDate: dueDate,
                            dueTime: row['เวลา'] || row['Time'] || row['dueTime'] || '',
                            createdAt: new Date().toISOString()
                        };

                        todos.push(todo);
                        imported++;
                    });

                    if (imported > 0) {
                        saveTodos();
                        renderTodos();
                        updateStats();
                        updateNotifications();
                        renderWeekPlan();
                        showToast(`นำเข้าสำเร็จ ${imported} รายการ! ✅`);
                    } else {
                        showToast('ไม่พบข้อมูลที่สามารถนำเข้าได้ ❌', 'error');
                    }

                } catch (error) {
                    console.error('Import error:', error);
                    showToast('เกิดข้อผิดพลาดในการนำเข้า ❌', 'error');
                }
            };

            reader.readAsArrayBuffer(file);
            event.target.value = ''; // Reset input
            toggleExportMenu();
        }

        // Toast notification
        function showToast(message, type = 'success') {
            const toast = document.createElement('div');
            toast.style.cssText = `
                position: fixed;
                bottom: 30px;
                left: 50%;
                transform: translateX(-50%);
                background: ${type === 'error' ? 'var(--danger)' : 'var(--success)'};
                color: white;
                padding: 16px 24px;
                border-radius: 12px;
                box-shadow: var(--shadow-lg);
                z-index: 10000;
                font-weight: 600;
                animation: toastSlide 0.3s ease-out;
            `;
            toast.textContent = message;
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.animation = 'toastSlide 0.3s ease-out reverse';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        // Theme Toggle
        function toggleTheme() {
            currentTheme = currentTheme === 'light' ? 'dark' : 'light';
            localStorage.setItem('theme', currentTheme);
            applyTheme();
        }

        function applyTheme() {
            document.documentElement.setAttribute('data-theme', currentTheme);
            document.getElementById('themeIcon').textContent = currentTheme === 'light' ? '🌙' : '☀️';
        }

        // Handle Enter Key
        function handleEnter(event) {
            if (event.key === 'Enter') {
                addTodo();
            }
        }

        // Save to LocalStorage
        async function saveTodos() {
            if (!currentUser) return;

            if (currentUser.role === 'admin' && viewingUser === 'all') {
                return;
            }

            const prefix = currentUser.role === 'admin' && viewingUser ? viewingUser + '_' : currentUser.username + '_';
            localStorage.setItem(prefix + 'todos', JSON.stringify(todos));
            localStorage.removeItem('todos');
            if (window.FirestoreAdapter) {
                await FirestoreAdapter.setItem(prefix + 'todos', todos);
            }
        }

        function refreshAllViews() {
            updateSidebarCounts();
            renderDashboardSummary();
            renderTodos();
            updateStats();
            updateNotifications();
            renderWeekPlan();
            renderCalendar(); // Always refresh calendar
            scheduleNextTodoNotification();
        }

        // Switch View
        function switchView(view) {
            currentView = view;
            
            // Update buttons
            document.querySelectorAll('.view-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            event.target.classList.add('active');

            // Toggle views
            if (view === 'list') {
                document.getElementById('todoSections').style.display = 'grid';
                document.getElementById('calendarView').classList.remove('active');
            } else {
                document.getElementById('todoSections').style.display = 'none';
                document.getElementById('calendarView').classList.add('active');
                renderCalendar();
            }
        }

        // Calendar Functions
        function renderCalendar() {
            const year = currentCalendarDate.getFullYear();
            const month = currentCalendarDate.getMonth();
            
            // Update title
            const monthNames = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
                              'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
            document.getElementById('calendarMonth').textContent = `${monthNames[month]} ${year + 543}`;

            // Calculate month stats
            const firstDayOfMonth = toDateKey(new Date(year, month, 1));
            const lastDayOfMonth = toDateKey(new Date(year, month + 1, 0));
            
            const monthTodos = todos.filter(t => t.dueDate >= firstDayOfMonth && t.dueDate <= lastDayOfMonth);
            const monthCompleted = monthTodos.filter(t => t.completed).length;
            const monthPending = monthTodos.length - monthCompleted;
            const monthDayOffs = dayOffs
                .map(getDayOffDateValue)
                .filter(d => d >= firstDayOfMonth && d <= lastDayOfMonth).length;

            document.getElementById('calMonthTodos').textContent = monthTodos.length;
            document.getElementById('calMonthCompleted').textContent = monthCompleted;
            document.getElementById('calMonthPending').textContent = monthPending;
            document.getElementById('calMonthDayOff').textContent = monthDayOffs;

            // Calculate leave stats
            const monthLeaves = leaveDays.filter(l => l && l.date >= firstDayOfMonth && l.date <= lastDayOfMonth);
            const holidayCount = monthLeaves.filter(l => l.type === 'holiday').length;
            const vacationCount = monthLeaves.filter(l => l.type === 'vacation').length;
            const sickCount = monthLeaves.filter(l => l.type === 'sick').length;
            const personalCount = monthLeaves.filter(l => l.type === 'personal').length;

            const holidayEl = document.getElementById('leaveHolidayCount');
            const vacationEl = document.getElementById('leaveVacationCount');
            const sickEl = document.getElementById('leaveSickCount');
            const personalEl = document.getElementById('leavePersonalCount');
            
            if (holidayEl) holidayEl.textContent = holidayCount;
            if (vacationEl) vacationEl.textContent = vacationCount;
            if (sickEl) sickEl.textContent = sickCount;
            if (personalEl) personalEl.textContent = personalCount;

            // Get first day of month and number of days
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const daysInPrevMonth = new Date(year, month, 0).getDate();

            const grid = document.getElementById('calendarGrid');
            grid.innerHTML = '';

            // Add day headers
            const dayNames = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
            dayNames.forEach(day => {
                const header = document.createElement('div');
                header.className = 'calendar-day-header';
                header.textContent = day;
                grid.appendChild(header);
            });

            // Add days from previous month
            for (let i = firstDay - 1; i >= 0; i--) {
                const day = daysInPrevMonth - i;
                const dayDiv = createCalendarDay(day, month - 1, year, true);
                grid.appendChild(dayDiv);
            }

            // Add days of current month
            const today = new Date();
            for (let day = 1; day <= daysInMonth; day++) {
                const isToday = day === today.getDate() && 
                               month === today.getMonth() && 
                               year === today.getFullYear();
                const dayDiv = createCalendarDay(day, month, year, false, isToday);
                grid.appendChild(dayDiv);
            }

            // Add days from next month to fill the grid
            const totalCells = grid.children.length - 7; // minus headers
            const remainingCells = 42 - totalCells - 7; // 6 rows * 7 days - headers
            for (let day = 1; day <= remainingCells; day++) {
                const dayDiv = createCalendarDay(day, month + 1, year, true);
                grid.appendChild(dayDiv);
            }
        }

        function createCalendarDay(day, month, year, otherMonth = false, isToday = false) {
            const dayDiv = document.createElement('div');
            dayDiv.className = 'calendar-day';
            
            if (otherMonth) {
                dayDiv.classList.add('other-month');
            }
            if (isToday) {
                dayDiv.classList.add('today');
            }

            // Get todos for this day
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const thaiHoliday = getThaiHoliday(dateStr);
            const dayTodos = todos.filter(t => t.dueDate === dateStr && !(t && t.recurring && !t.parentId));
            const isDayOff = hasDayOffOnDate(dateStr);
            const dayLeaves = getLeaveEntriesForDate(dateStr);
            const dayLeave = dayLeaves.length > 0 ? dayLeaves[0] : null;
            
            // Check for overdue todos
            const currentDate = new Date();
            currentDate.setHours(0, 0, 0, 0);
            const thisDate = new Date(year, month, day);
            thisDate.setHours(0, 0, 0, 0);
            const hasOverdue = dayTodos.some(t => !t.completed && thisDate < currentDate);
            
            // Get branch info for the day
            const branchesForDay = new Set();
            dayTodos.forEach(t => {
                if (t.branches && t.branches.length > 0) {
                    t.branches.forEach(b => branchesForDay.add(b));
                }
            });
            const branchText = branchesForDay.size > 0 ? 
                Array.from(branchesForDay).join(',') : '';

            if (dayTodos.length > 0) {
                dayDiv.classList.add('has-todos');
            }
            
            if (isDayOff || dayLeave) {
                dayDiv.classList.add('day-off');
            }

            if (hasOverdue) {
                dayDiv.style.background = 'rgba(239, 68, 68, 0.1)';
            }

            // Get leave badge HTML
            let leaveBadgeHTML = '';
            
            if (isAllViewMode()) {
                const dayOffOwners = getDayOffOwnersForDate(dateStr);
                const leaveEntries = getLeaveEntriesForDate(dateStr);
                
                let badges = [];
                
                dayOffOwners.forEach(owner => {
                    badges.push(`<div class="day-off-badge" style="background: linear-gradient(135deg, #06b6d4, #0891b2);">🏖️ ${getUserDisplayName(owner)}: Day Off</div>`);
                });
                
                leaveEntries.forEach(leave => {
                    const leaveInfo = leaveTypes[leave.type];
                    if (leaveInfo) {
                        const bgColor = {
                            holiday: 'linear-gradient(135deg, #f59e0b, #d97706)',
                            vacation: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                            sick: 'linear-gradient(135deg, #ef4444, #dc2626)',
                            personal: 'linear-gradient(135deg, #8b5cf6, #7c3aed)'
                        };
                        badges.push(`<div class="day-off-badge" style="background: ${bgColor[leave.type] || '#888'};">${leaveInfo.icon} ${getUserDisplayName(leave.owner)}: ${leaveInfo.name}</div>`);
                    }
                });
                
                // Wrap in a container for flex column layout
                if (badges.length > 0) {
                    // Show max 3 badges, else +more
                    if (badges.length > 3) {
                        const visibleBadges = badges.slice(0, 3).join('');
                        const moreCount = badges.length - 3;
                        leaveBadgeHTML = `<div class="day-off-badges-container" style="display: flex; flex-direction: column; gap: 4px;">${visibleBadges}<div class="day-off-badge" style="background: #64748b; font-size: 0.7em;">+${moreCount} คน</div></div>`;
                    } else {
                        leaveBadgeHTML = `<div class="day-off-badges-container" style="display: flex; flex-direction: column; gap: 4px;">${badges.join('')}</div>`;
                    }
                }
                
            } else {
                if (isDayOff) {
                    leaveBadgeHTML = `<div class="day-off-badges-container" style="display: flex; flex-direction: column; gap: 4px;"><div class="day-off-badge" style="background: linear-gradient(135deg, #06b6d4, #0891b2);">🏖️ Day Off</div></div>`;
                } else if (dayLeave) {
                    const leaveInfo = leaveTypes[dayLeave.type];
                    const bgColor = {
                        holiday: 'linear-gradient(135deg, #f59e0b, #d97706)',
                        vacation: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                        sick: 'linear-gradient(135deg, #ef4444, #dc2626)',
                        personal: 'linear-gradient(135deg, #8b5cf6, #7c3aed)'
                    };
                    leaveBadgeHTML = `<div class="day-off-badges-container" style="display: flex; flex-direction: column; gap: 4px;"><div class="day-off-badge" style="background: ${bgColor[dayLeave.type]};">${leaveInfo.icon} ${leaveInfo.name}</div></div>`;
                }
            }

            dayDiv.innerHTML = `
                <div class="day-number">
                    ${day} 
                    ${thaiHoliday ? `<span style="font-size: 0.85rem; color: #ef4444; font-weight: 600; margin-left: 6px;">(${thaiHoliday})</span>` : ''}
                </div>
                ${leaveBadgeHTML}
                <div class="calendar-day-content">
                    ${(() => {
                        // Show branch visits first (at top)
                        const dayVisits = branchVisits.filter(v => v.date === dateStr);
                        const visitHTML = dayVisits.map(visit => {
                            const timeIn = (visit.timeIn || visit.time || '').substring(0, 5);
                            const timeOut = (visit.timeOut || '').substring(0, 5);
                            const timeText = timeOut ? `${timeIn}-${timeOut}` : timeIn;
                            const branchDisplay = visit.branch ? (branchNames[visit.branch] || visit.branch) : '';
                            const visitTitle = visit.branch ? `${branchDisplay}` : 'เวลางาน';
                            return `
                            <div class="calendar-branch-visit" onclick="event.stopPropagation(); editBranchVisit(${visit.id})">
                                <div class="branch-visit-branch">
                                    <span>🏢</span>
                                    <span>${visit.owner ? `(${getUserDisplayName(visit.owner)}) ` : ''}${visitTitle}</span>
                                </div>
                                <div class="branch-visit-time">⏰ ${timeText}</div>
                            </div>
                        `}).join('');
                        
                        // Then show regular tasks
                        const taskHTML = dayTodos.slice(0, 3).map(todo => {
                            const time = todo.timeStart ? todo.timeStart.substring(0, 5) : '';
                            const branch = todo.branches && todo.branches.length > 0 ? todo.branches[0] : '';
                            const taskText = todo.text.length > 15 ? todo.text.substring(0, 15) + '...' : todo.text;
                            const icon = todo.icon ? todo.icon + ' ' : '';
                            return `
                                <div class="calendar-task-item priority-${todo.priority} ${todo.completed ? 'completed' : ''}" 
                                     onclick="event.stopPropagation(); editTodo(${todo.id})">
                                    <div class="calendar-task-main">
                                        ${todo.owner ? `<span style="font-size:0.7em; margin-right:2px; opacity:0.8;">(${getUserDisplayName(todo.owner)})</span>` : ''}
                                        ${branch ? `<span class="calendar-task-branch">${branch}</span>` : ''}
                                        ${time ? `<span class="calendar-task-time">${time}</span>` : ''}
                                        <span class="calendar-task-text">${icon}${taskText}</span>
                                    </div>
                                </div>
                            `;
                        }).join('');
                        
                        const moreHTML = dayTodos.length > 3 ? `<div class="calendar-more-tasks">+${dayTodos.length - 3} งาน</div>` : '';
                        
                        return visitHTML + taskHTML + moreHTML;
                    })()}
                </div>
            `;

            // Click to show todos (for +more tasks or empty space)
            dayDiv.onclick = () => showDayTodos(dateStr, day, month, year);

            return dayDiv;
        }

        function showDayTodos(dateStr, day, month, year) {
            currentSelectedDate = dateStr;
            const dayTodos = todos.filter(t => t.dueDate === dateStr && !(t && t.recurring && !t.parentId));
            const dayVisits = branchVisits.filter(v => v.date === dateStr);
            const isDayOff = hasDayOffOnDate(dateStr);
            const dayLeaves = getLeaveEntriesForDate(dateStr);
            const dayLeave = dayLeaves.length > 0 ? dayLeaves[0] : null;
            const isAllView = isAllViewMode();
            
            const monthNames = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
                              'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
            
            document.getElementById('modalDate').textContent = `งานวันที่ ${day} ${monthNames[month]} ${year + 543}`;
            
            // Set leave type radio buttons
            const leaveTypeSection = document.getElementById('leaveTypeSection');
            const adminUserStatusSection = document.getElementById('adminUserStatusSection');
            const adminUserStatusList = document.getElementById('adminUserStatusList');
            
            if (isAllView) {
                if (leaveTypeSection) leaveTypeSection.style.display = 'none';
                if (adminUserStatusSection) {
                    adminUserStatusSection.style.display = 'block';
                    // Populate user list
                    adminUserStatusList.innerHTML = '';
                    const sortedUsers = [...users].sort((a, b) => a.username === 'admin' ? -1 : 1);
                    sortedUsers.forEach(u => {
                        if (u.username === 'admin' && currentUser.username !== 'admin') return;
                        
                        const userDayOff = dayOffs.find(d => getDayOffDateValue(d) === dateStr && (d.owner === u.username || (u.username === 'admin' && d.owner === 'legacy')));
                        const userLeave = leaveDays.find(l => l.date === dateStr && l.owner === u.username);
                        
                        let currentValue = '';
                        if (userDayOff) currentValue = 'dayoff';
                        else if (userLeave) currentValue = userLeave.type;
                        
                        const row = document.createElement('div');
                        row.style.display = 'flex';
                        row.style.alignItems = 'center';
                        row.style.justifyContent = 'space-between';
                        row.style.padding = '8px';
                        row.style.background = 'rgba(255,255,255,0.05)';
                        row.style.borderRadius = '8px';
                        
                        const nameSpan = document.createElement('span');
                        nameSpan.textContent = `👤 ${getUserDisplayName(u.username)}`;
                        nameSpan.style.fontWeight = '500';
                        
                        const select = document.createElement('select');
                        select.style.padding = '4px 8px';
                        select.style.borderRadius = '4px';
                        select.style.border = '1px solid var(--border)';
                        select.style.background = 'var(--bg-card)';
                        select.style.color = 'var(--text-primary)';
                        select.onchange = async (e) => updateUserStatusInAllView(u.username, dateStr, e.target.value);
                        
                        const options = [
                            { val: '', text: '✅ ทำงาน' },
                            { val: 'dayoff', text: '🏖️ Day Off' },
                            { val: 'holiday', text: '🎉 ลานักขัตฤกษ์' },
                            { val: 'vacation', text: '🏝️ ลาพักร้อน' },
                            { val: 'sick', text: '🤒 ลาป่วย' },
                            { val: 'personal', text: '📝 ลากิจ' }
                        ];
                        
                        options.forEach(opt => {
                            const option = document.createElement('option');
                            option.value = opt.val;
                            option.textContent = opt.text;
                            if (opt.val === currentValue) option.selected = true;
                            select.appendChild(option);
                        });
                        
                        row.appendChild(nameSpan);
                        row.appendChild(select);
                        adminUserStatusList.appendChild(row);
                    });
                }
            } else {
                if (leaveTypeSection) leaveTypeSection.style.display = 'block';
                if (adminUserStatusSection) adminUserStatusSection.style.display = 'none';
                
                const radios = document.getElementsByName('leaveType');
                radios.forEach(radio => {
                    if (isDayOff && radio.value === 'dayoff') {
                        radio.checked = true;
                    } else if (dayLeave && radio.value === dayLeave.type) {
                        radio.checked = true;
                    } else if (!isDayOff && !dayLeave && radio.value === '') {
                        radio.checked = true;
                    }
                });
            }
            
            const modalTodos = document.getElementById('modalTodos');
            modalTodos.innerHTML = '';

            if (isAllView && (isDayOff || dayLeaves.length > 0)) {
                const leaveSection = document.createElement('div');
                leaveSection.style.marginBottom = '15px';
                leaveSection.innerHTML = '<div style="font-weight: 600; margin-bottom: 10px; color: var(--secondary);">🏖️ วันลาและหยุด</div>';

                const lines = [];
                if (isDayOff) {
                    getDayOffOwnersForDate(dateStr).forEach(owner => {
                        lines.push(`🏖️ (${getUserDisplayName(owner)}) Day Off`);
                    });
                }
                dayLeaves.forEach(leave => {
                    const leaveInfo = leaveTypes[leave.type];
                    if (!leaveInfo) return;
                    lines.push(`${leaveInfo.icon} (${getUserDisplayName(leave.owner)}) ${leaveInfo.name}`);
                });

                if (lines.length > 0) {
                    const box = document.createElement('div');
                    box.className = 'todo-item';
                    box.style.marginBottom = '10px';
                    box.innerHTML = `
                        <div class="todo-content">
                            <div class="todo-text">${lines.join('<br>')}</div>
                        </div>
                        <div class="todo-actions"></div>
                    `;
                    leaveSection.appendChild(box);
                }

                modalTodos.appendChild(leaveSection);
            }

            // Show work times first with edit/delete buttons
            if (dayVisits.length > 0) {
                const visitsSection = document.createElement('div');
                visitsSection.style.marginBottom = '15px';
                visitsSection.innerHTML = '<div style="font-weight: 600; margin-bottom: 10px; color: var(--success);">🕘 เวลางาน</div>';
                
                dayVisits.forEach(visit => {
                    const timeIn = (visit.timeIn || visit.time || '').substring(0, 5);
                    const timeOut = (visit.timeOut || '').substring(0, 5);
                    const timeText = timeOut ? `${timeIn}-${timeOut}` : timeIn;
                    const branchDisplay = visit.branch ? (branchNames[visit.branch] || visit.branch) : '';
                    const visitTitle = visit.branch ? `🏢 ${branchDisplay}` : '🕘 เวลางาน';
                    const visitItem = document.createElement('div');
                    visitItem.className = 'todo-item';
                    visitItem.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(5, 150, 105, 0.1))';
                    visitItem.style.borderLeft = '4px solid var(--success)';
                    visitItem.innerHTML = `
                        <div class="checkbox-wrapper">
                            <div style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">
                                🕘
                            </div>
                        </div>
                        <div class="todo-content">
                            <div class="todo-text">${visit.owner ? `(${getUserDisplayName(visit.owner)}) ` : ''}${visitTitle}</div>
                            <div class="todo-meta">
                                <span class="due-date">⏰ ${timeText}</span>
                            </div>
                        </div>
                        <div class="todo-actions">
                            <button class="icon-btn" onclick="editBranchVisit(${visit.id})" title="แก้ไข">✏️</button>
                            <button class="icon-btn delete" onclick="deleteBranchVisitFromModal(${visit.id})" title="ลบ">🗑️</button>
                        </div>
                    `;
                    visitsSection.appendChild(visitItem);
                });
                
                modalTodos.appendChild(visitsSection);
            }

            // Show regular todos
            if (dayTodos.length === 0 && dayVisits.length === 0) {
                let statusHTML = '';
                if (isAllView) {
                    const lines = [];
                    if (isDayOff) {
                        getDayOffOwnersForDate(dateStr).forEach(owner => {
                            lines.push(`🏖️ (${getUserDisplayName(owner)}) Day Off`);
                        });
                    }
                    dayLeaves.forEach(leave => {
                        const leaveInfo = leaveTypes[leave.type];
                        if (!leaveInfo) return;
                        lines.push(`${leaveInfo.icon} (${getUserDisplayName(leave.owner)}) ${leaveInfo.name}`);
                    });
                    statusHTML = lines.join('<br>');
                } else {
                    if (isDayOff) statusHTML = '🏖️ Day Off';
                    else if (dayLeave) {
                        const leaveInfo = leaveTypes[dayLeave.type];
                        statusHTML = `${leaveInfo.icon} ${leaveInfo.name}`;
                    }
                }
                
                modalTodos.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">📭</div>
                        <div class="empty-state-text">ไม่มีงานในวันนี้</div>
                        ${statusHTML ? `<p style="color: var(--secondary); font-weight: 600;">${statusHTML}</p>` : ''}
                    </div>
                `;
            } else if (dayTodos.length > 0) {
                if (dayVisits.length > 0) {
                    const todosSection = document.createElement('div');
                    todosSection.innerHTML = '<div style="font-weight: 600; margin-bottom: 10px; color: var(--text-primary);">📋 งานประจำวัน</div>';
                    modalTodos.appendChild(todosSection);
                }
                
                dayTodos.forEach(todo => {
                    modalTodos.appendChild(createTodoItem(todo));
                });
            }

            document.getElementById('calendarModal').classList.add('active');
        }

        function deleteBranchVisitFromModal(id) {
            if (!confirm('ต้องการลบเวลางานนี้?')) return;

            branchVisits = branchVisits.filter(v => v.id !== id);
            saveBranchVisits();
            renderCalendar();
            renderWeekPlan();

            // Refresh modal
            if (currentSelectedDate) {
                const date = new Date(currentSelectedDate);
                showDayTodos(currentSelectedDate, date.getDate(), date.getMonth(), date.getFullYear());
            }

            showToast('🗑️ ลบเวลางานสำเร็จ');
        }

        function handleLeaveTypeChange() {
            if (!currentSelectedDate) return;
            if (currentUser && currentUser.role === 'admin' && viewingUser === 'all') {
                showToast('โหมดดูทั้งหมดไม่สามารถแก้ไขวันลา/หยุดได้', 'error');
                return;
            }
            
            const selectedType = document.querySelector('input[name="leaveType"]:checked').value;
            
            // Remove from dayOffs if exists
            const dayOffIndex = dayOffs.indexOf(currentSelectedDate);
            if (dayOffIndex !== -1) {
                dayOffs.splice(dayOffIndex, 1);
            }
            
            // Remove from leaveDays if exists
            const leaveIndex = leaveDays.findIndex(l => l.date === currentSelectedDate);
            if (leaveIndex !== -1) {
                leaveDays.splice(leaveIndex, 1);
            }
            
            // Add based on selection
            if (selectedType === 'dayoff') {
                dayOffs.push(currentSelectedDate);
                showToast('✅ ตั้งเป็น Day Off แล้ว!');
            } else if (selectedType !== '') {
                leaveDays.push({
                    date: currentSelectedDate,
                    type: selectedType,
                    createdAt: new Date().toISOString()
                });
                const leaveInfo = leaveTypes[selectedType];
                showToast(`✅ ตั้งเป็น${leaveInfo.name}แล้ว!`);
            } else {
                showToast('✅ เปลี่ยนเป็นวันทำงานแล้ว');
            }
            saveDayOffsAndLeaves();
            renderCalendar();
            renderWeekPlan();
            renderDashboardSummary();
        }

        function toggleDayOff() {
            if (!currentSelectedDate) return;
            if (currentUser && currentUser.role === 'admin' && viewingUser === 'all') {
                showToast('โหมดดูทั้งหมดไม่สามารถแก้ไขวันลา/หยุดได้', 'error');
                return;
            }
            
            const checkbox = document.getElementById('dayOffCheckbox');
            const index = dayOffs.indexOf(currentSelectedDate);
            
            if (checkbox.checked && index === -1) {
                dayOffs.push(currentSelectedDate);
                showToast('✅ ตั้งเป็นวันหยุดแล้ว!');
            } else if (!checkbox.checked && index !== -1) {
                dayOffs.splice(index, 1);
                showToast('❌ ยกเลิกวันหยุดแล้ว');
            }
            saveDayOffsAndLeaves();
            renderCalendar();
        }

        async function updateUserStatusInAllView(username, dateStr, status) {
            const dayOffIndex = dayOffs.findIndex(d => getDayOffDateValue(d) === dateStr && d.owner === username);
            if (dayOffIndex !== -1) dayOffs.splice(dayOffIndex, 1);
            
            const leaveIndex = leaveDays.findIndex(l => l.date === dateStr && l.owner === username);
            if (leaveIndex !== -1) leaveDays.splice(leaveIndex, 1);
            
            if (status === 'dayoff') {
                dayOffs.push({ date: dateStr, owner: username });
            } else if (status !== '') {
                leaveDays.push({
                    date: dateStr,
                    type: status,
                    owner: username,
                    createdAt: new Date().toISOString()
                });
            }
            
            const userDayOffs = dayOffs.filter(d => d.owner === username).map(d => getDayOffDateValue(d));
            const userLeaves = leaveDays
                .filter(l => l.owner === username)
                .map(l => ({ date: l.date, type: l.type, createdAt: l.createdAt }));
            
            const prefix = username + '_';
            try {
                localStorage.setItem(prefix + 'dayOffs', JSON.stringify(userDayOffs));
                localStorage.setItem(prefix + 'leaveDays', JSON.stringify(userLeaves));
                if (window.FirestoreAdapter) {
                    await FirestoreAdapter.setItem(prefix + 'dayOffs', userDayOffs);
                    await FirestoreAdapter.setItem(prefix + 'leaveDays', userLeaves);
                }
                showToast(`✅ อัปเดตสถานะของ ${getUserDisplayName(username)} แล้ว`);
            } catch (e) {
                showToast('บันทึกไม่สำเร็จ', 'error');
            }
            
            renderCalendar();
            renderWeekPlan();
            renderDashboardSummary();
        }

        function closeModal(event) {
            if (!event || event.target.id === 'calendarModal') {
                document.getElementById('calendarModal').classList.remove('active');
            }
        }

        function previousMonth() {
            currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
            renderCalendar();
        }

        function nextMonth() {
            currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
            renderCalendar();
        }

        function todayMonth() {
            currentCalendarDate = new Date();
            renderCalendar();
        }

        // Discord Webhook
        async function sendDiscordNotification(taskText, assignees, dueDate, timeStart, priority, createdBy) {
            if (!discordWebhookUrl) return;
            try {
                const priorityLabel = { high: '🔴 สูง', medium: '🟡 กลาง', low: '🟢 ต่ำ' }[priority] || priority || '-';
                const assigneeNames = (Array.isArray(assignees) ? assignees : [assignees])
                    .filter(Boolean)
                    .map(u => getUserDisplayName(u))
                    .join(', ');
                const dateDisplay = dueDate ? formatDate(dueDate) : '-';
                const timeDisplay = timeStart ? ` ⏰ ${timeStart}` : '';
                const creatorDisplay = createdBy ? getUserDisplayName(createdBy) : '-';
                const embed = {
                    title: '📋 มีงานใหม่ถูกมอบหมาย',
                    color: priority === 'high' ? 0xe74c3c : priority === 'low' ? 0x2ecc71 : 0xf39c12,
                    fields: [
                        { name: '📝 งาน', value: taskText || '-', inline: false },
                        { name: '👤 มอบหมายให้', value: assigneeNames || '-', inline: true },
                        { name: '🚩 ความสำคัญ', value: priorityLabel, inline: true },
                        { name: '📅 วันที่', value: dateDisplay + timeDisplay, inline: true },
                        { name: '✍️ โดย', value: creatorDisplay, inline: true }
                    ],
                    timestamp: new Date().toISOString()
                };
                await fetch(discordWebhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ embeds: [embed] })
                });
            } catch (e) {}
        }

        async function sendDiscordCompletionNotification(todo, ownerUsername) {
            if (!discordWebhookUrl) return;
            try {
                const ownerName = getUserDisplayName(ownerUsername);
                const dateDisplay = todo.dueDate ? formatDate(todo.dueDate) : '';
                const timeDisplay = todo.timeStart ? ` ⏰ ${todo.timeStart}` : '';
                const embed = {
                    title: '✅ งานเสร็จแล้ว',
                    color: 0x2ecc71,
                    fields: [
                        { name: '📝 งาน', value: todo.text || '-', inline: false },
                        { name: '👤 ผู้รับผิดชอบ', value: ownerName, inline: true },
                        { name: '📅 วันที่', value: (dateDisplay + timeDisplay) || '-', inline: true }
                    ],
                    timestamp: new Date().toISOString()
                };
                await fetch(discordWebhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ embeds: [embed] })
                });
            } catch (e) {}
        }

        async function saveDiscordSettings() {
            const urlInput = document.getElementById('settingsDiscordWebhookInput');
            const timeInput = document.getElementById('settingsDiscordSummaryTime');
            const enabledInput = document.getElementById('settingsDiscordSummaryEnabled');
            const minutesInput = document.getElementById('settingsDiscordNotifyMinutes');
            discordWebhookUrl = urlInput ? urlInput.value.trim() : discordWebhookUrl;
            discordSummaryTime = timeInput ? timeInput.value || '08:00' : discordSummaryTime;
            discordSummaryEnabled = enabledInput ? enabledInput.checked : discordSummaryEnabled;
            discordNotifyMinutesBefore = minutesInput ? Math.max(0, parseInt(minutesInput.value) || 0) : discordNotifyMinutesBefore;
            await setAppItem('discordWebhookUrl', discordWebhookUrl);
            await setAppItem('discordSummaryTime', discordSummaryTime);
            await setAppItem('discordSummaryEnabled', discordSummaryEnabled);
            await setAppItem('discordNotifyMinutesBefore', discordNotifyMinutesBefore);
            showToast('✅ บันทึกการตั้งค่า Discord แล้ว');
        }

        // Keep old name as alias for compatibility
        async function saveDiscordWebhookUrl() { await saveDiscordSettings(); }

        // Notifications
        function updateNotifications() {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const todayKey = toDateKey(today);
            const tomorrowKey = toDateKey(tomorrow);
            
            let notifications = [];

            // Overdue tasks
            const overdue = todos.filter(t => {
                if (!t.dueDate || t.completed) return false;
                const dueDate = parseDateKeyLocal(t.dueDate);
                return dueDate ? dueDate < today : false;
            });

            overdue.forEach(todo => {
                notifications.push({
                    type: 'urgent',
                    text: `เลยกำหนด: ${todo.text}`,
                    time: `ครบกำหนด: ${formatDate(todo.dueDate)}${todo.dueTime ? ' ' + todo.dueTime : ''}`,
                    todo: todo
                });
            });

            // Today's tasks
            const todayTasks = todos.filter(t => {
                if (!t.dueDate || t.completed) return false;
                return t.dueDate === todayKey;
            });

            todayTasks.forEach(todo => {
                notifications.push({
                    type: 'today',
                    text: `วันนี้: ${todo.text}`,
                    time: todo.dueTime ? `⏰ ${todo.dueTime}` : 'ทั้งวัน',
                    todo: todo
                });
            });

            // Tomorrow's tasks
            const tomorrowTasks = todos.filter(t => {
                if (!t.dueDate || t.completed) return false;
                return t.dueDate === tomorrowKey;
            });

            tomorrowTasks.forEach(todo => {
                notifications.push({
                    type: 'tomorrow',
                    text: `พรุ่งนี้: ${todo.text}`,
                    time: todo.dueTime ? `⏰ ${todo.dueTime}` : 'ทั้งวัน',
                    todo: todo
                });
            });

            // Update badge
            const badge = document.getElementById('notificationBadge');
            const count = document.getElementById('notificationCount');
            if (notifications.length > 0) {
                badge.style.display = 'flex';
                badge.textContent = notifications.length;
                count.textContent = `(${notifications.length})`;
            } else {
                badge.style.display = 'none';
                count.textContent = '';
            }

            // Render notifications
            const list = document.getElementById('notificationList');
            list.innerHTML = '';

            if (notifications.length === 0) {
                list.innerHTML = `
                    <div class="empty-state" style="padding: 30px;">
                        <div class="empty-state-icon" style="font-size: 3rem;">✅</div>
                        <div class="empty-state-text">ไม่มีการแจ้งเตือน</div>
                        <p style="color: var(--text-secondary); font-size: 0.9rem;">คุณทำงานได้ดีมาก!</p>
                    </div>
                `;
            } else {
                notifications.forEach(notif => {
                    const item = document.createElement('div');
                    item.className = `notification-item ${notif.type}`;
                    item.innerHTML = `
                        <div class="notification-text">${notif.text}</div>
                        <div class="notification-time">${notif.time}</div>
                    `;
                    item.onclick = () => {
                        toggleNotifications();
                        // Scroll to todo in list view
                        if (currentView === 'calendar') {
                            switchView('list');
                        }
                    };
                    list.appendChild(item);
                });
            }

            maybePlayNotificationSound(notifications);
            processDueTodoNotifications();
        }

        function toggleNotifications() {
            const panel = document.getElementById('notificationPanel');
            panel.classList.toggle('show');
        }

        let notificationSoundEnabled = false;
        let notificationSoundType = 'beep';
        let notificationAudioContext = null;
        let notificationAudioUnlocked = false;
        let lastNotificationSignature = null;
        let notificationSoundHintShown = false;

        function initNotificationSoundUI() {
            notificationSoundEnabled = localStorage.getItem('notificationSoundEnabled') === 'true';
            const toggle = document.getElementById('notificationSoundToggle');
            if (toggle) toggle.checked = notificationSoundEnabled;

            notificationSoundType = localStorage.getItem('notificationSoundType') || 'beep';
            const typeSelect = document.getElementById('notificationSoundType');
            if (typeSelect) typeSelect.value = notificationSoundType;
        }

        function urlBase64ToUint8Array(base64String) {
            const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
            const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
            const rawData = atob(base64);
            const outputArray = new Uint8Array(rawData.length);
            for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
            return outputArray;
        }

        async function getExistingPushSubscription() {
            if (!('serviceWorker' in navigator)) return null;
            if (!('PushManager' in window)) return null;
            try {
                const reg = await navigator.serviceWorker.ready;
                return await reg.pushManager.getSubscription();
            } catch (e) {
                return null;
            }
        }

        async function initPushUI() {
            const statusEl = document.getElementById('pushStatusText');
            const btn = document.getElementById('pushToggleBtn');
            if (!statusEl || !btn) return;

            if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
                statusEl.textContent = 'อุปกรณ์ไม่รองรับ';
                btn.style.display = 'none';
                return;
            }

            const vapidKey = (window.PUSH_VAPID_PUBLIC_KEY || '').trim();
            if (!vapidKey) {
                statusEl.textContent = 'ยังไม่ได้ตั้งค่า VAPID key';
                btn.textContent = 'เปิด';
                btn.disabled = true;
                btn.style.opacity = '0.6';
                btn.style.cursor = 'not-allowed';
                return;
            }
            btn.disabled = false;
            btn.style.opacity = '';
            btn.style.cursor = '';

            const perm = Notification.permission;
            const sub = await getExistingPushSubscription();
            if (sub) {
                statusEl.textContent = 'เปิดอยู่';
                btn.textContent = 'ปิด';
                btn.classList.remove('btn-primary');
                btn.classList.add('btn-secondary');
            } else if (perm === 'denied') {
                statusEl.textContent = 'ถูกปฏิเสธสิทธิ์ (เปิดในตั้งค่าเบราว์เซอร์)';
                btn.textContent = 'เปิด';
                btn.classList.remove('btn-secondary');
                btn.classList.add('btn-primary');
            } else {
                statusEl.textContent = 'ปิดอยู่';
                btn.textContent = 'เปิด';
                btn.classList.remove('btn-secondary');
                btn.classList.add('btn-primary');
            }
        }

        async function togglePushNotifications() {
            const sub = await getExistingPushSubscription();
            if (sub) {
                await disablePushNotifications();
            } else {
                await enablePushNotifications();
            }
            await initPushUI();
        }

        async function enablePushNotifications() {
            if (!currentUser) {
                showToast('กรุณาเข้าสู่ระบบก่อน', 'error');
                return;
            }
            if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
                showToast('อุปกรณ์ไม่รองรับ Push', 'error');
                return;
            }
            const vapidKey = (window.PUSH_VAPID_PUBLIC_KEY || '').trim();
            if (!vapidKey) {
                showToast('ยังไม่ได้ตั้งค่า VAPID key', 'error');
                return;
            }

            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                showToast('ไม่ได้รับอนุญาตแจ้งเตือน', 'error');
                return;
            }

            await registerServiceWorker();
            const reg = await navigator.serviceWorker.ready;
            const applicationServerKey = urlBase64ToUint8Array(vapidKey);
            const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });

            const payload = sub.toJSON ? sub.toJSON() : sub;
            await setAppItem(`${currentUser.username}_pushSubscription`, payload);
            showToast('📲 เปิด Push แล้ว');
        }

        async function disablePushNotifications() {
            if (!currentUser) return;
            const sub = await getExistingPushSubscription();
            if (sub) {
                try { await sub.unsubscribe(); } catch (e) {}
            }
            await setAppItem(`${currentUser.username}_pushSubscription`, null);
            showToast('📴 ปิด Push แล้ว');
        }

        async function ensureNotificationAudioUnlocked() {
            try {
                if (!notificationAudioContext) {
                    const Ctx = window.AudioContext || window.webkitAudioContext;
                    if (!Ctx) return false;
                    notificationAudioContext = new Ctx();
                }
                if (notificationAudioContext.state === 'suspended') {
                    await notificationAudioContext.resume();
                }
                notificationAudioUnlocked = notificationAudioContext.state === 'running';
                return notificationAudioUnlocked;
            } catch (e) {
                return false;
            }
        }

        function playToneAt(ctx, startTime, frequency, duration, peakGain, waveType) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = waveType || 'sine';
            osc.frequency.setValueAtTime(frequency, startTime);
            gain.gain.setValueAtTime(0.0001, startTime);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peakGain), startTime + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + duration + 0.02);
        }

        function playNotificationBeep(type) {
            if (!notificationAudioContext || !notificationAudioUnlocked) return;
            const ctx = notificationAudioContext;
            const now = ctx.currentTime;
            const t = type || notificationSoundType || 'beep';

            if (t === 'double') {
                playToneAt(ctx, now, 880, 0.16, 0.16);
                playToneAt(ctx, now + 0.22, 880, 0.16, 0.16);
                return;
            }

            if (t === 'triple') {
                playToneAt(ctx, now, 880, 0.14, 0.14);
                playToneAt(ctx, now + 0.18, 880, 0.14, 0.14);
                playToneAt(ctx, now + 0.36, 880, 0.14, 0.14);
                return;
            }

            if (t === 'chime') {
                playToneAt(ctx, now, 784, 0.12, 0.12);
                playToneAt(ctx, now + 0.10, 988, 0.14, 0.12);
                playToneAt(ctx, now + 0.22, 1319, 0.18, 0.10);
                return;
            }

            if (t === 'soft') {
                playToneAt(ctx, now, 660, 0.22, 0.08);
                return;
            }

            if (t === 'ding') {
                playToneAt(ctx, now, 988, 0.35, 0.12, 'triangle');
                playToneAt(ctx, now, 1976, 0.22, 0.04, 'triangle');
                return;
            }

            if (t === 'bell') {
                playToneAt(ctx, now, 659, 0.40, 0.10, 'triangle');
                playToneAt(ctx, now + 0.02, 1319, 0.22, 0.04, 'triangle');
                return;
            }

            if (t === 'alarm') {
                playToneAt(ctx, now, 440, 0.18, 0.14, 'square');
                playToneAt(ctx, now + 0.22, 660, 0.18, 0.14, 'square');
                playToneAt(ctx, now + 0.44, 440, 0.18, 0.14, 'square');
                return;
            }

            playToneAt(ctx, now, 880, 0.22, 0.16);
        }

        async function testNotificationSound() {
            const ok = await ensureNotificationAudioUnlocked();
            if (!ok) {
                showToast('เบราว์เซอร์ไม่อนุญาตให้เล่นเสียง', 'error');
                return;
            }
            notificationSoundEnabled = true;
            localStorage.setItem('notificationSoundEnabled', 'true');
            const toggle = document.getElementById('notificationSoundToggle');
            if (toggle) toggle.checked = true;
            playNotificationBeep();
            showToast('🔊 ทดสอบเสียงแล้ว');
        }

        async function setNotificationSoundEnabled(enabled) {
            notificationSoundEnabled = !!enabled;
            localStorage.setItem('notificationSoundEnabled', notificationSoundEnabled ? 'true' : 'false');
            if (notificationSoundEnabled) {
                const ok = await ensureNotificationAudioUnlocked();
                if (!ok && !notificationSoundHintShown) {
                    notificationSoundHintShown = true;
                    showToast('เปิดเสียงแล้ว (ถ้าไม่ดัง กด "ทดสอบเสียง")');
                }
            }
        }

        function setNotificationSoundType(type) {
            notificationSoundType = type || 'beep';
            localStorage.setItem('notificationSoundType', notificationSoundType);
            if (notificationSoundEnabled) {
                testNotificationSound();
            }
        }

        function getNotificationSignature(notifications) {
            return notifications
                .map(n => {
                    const id = n && n.todo && (n.todo.id || n.todo.parentId) ? String(n.todo.id || n.todo.parentId) : '';
                    const due = n && n.todo && n.todo.dueDate ? String(n.todo.dueDate) : '';
                    const text = n && n.todo && n.todo.text ? String(n.todo.text) : (n && n.text ? String(n.text) : '');
                    return `${id}|${due}|${text}`;
                })
                .join('||');
        }

        function maybePlayNotificationSound(notifications) {
            const signature = getNotificationSignature(notifications);
            if (lastNotificationSignature === null) {
                lastNotificationSignature = signature;
                return;
            }
            if (signature !== lastNotificationSignature) {
                lastNotificationSignature = signature;
                if (notificationSoundEnabled) {
                    if (notificationAudioUnlocked) {
                        playNotificationBeep();
                    } else if (!notificationSoundHintShown) {
                        notificationSoundHintShown = true;
                        showToast('เปิดเสียงแล้ว (ต้องกด "ทดสอบเสียง" 1 ครั้งก่อน)', 'error');
                    }
                }
            }
        }

        let todoNotificationTimer = null;

        function getTodoNotificationKey(todo) {
            const u = currentUser ? currentUser.username : '';
            const minutesBefore = typeof todo.notifyMinutesBefore === 'number' ? todo.notifyMinutesBefore : 0;
            return `todoNotify_${u}_${todo.id}_${todo.dueDate || ''}_${todo.timeStart || ''}_${minutesBefore}`;
        }

        function getTodoTriggerTimeMs(todo) {
            if (!todo || !todo.notifyEnabled) return null;
            if (!todo.dueDate || !todo.timeStart) return null;
            const date = parseDateKeyLocal(todo.dueDate);
            if (!date) return null;
            const parts = String(todo.timeStart).split(':');
            if (parts.length < 2) return null;
            const h = parseInt(parts[0]) || 0;
            const m = parseInt(parts[1]) || 0;
            date.setHours(h, m, 0, 0);
            const minutesBefore = Math.max(0, Math.min(1440, parseInt(todo.notifyMinutesBefore) || 0));
            return date.getTime() - minutesBefore * 60 * 1000;
        }

        function fireTodoNotification(todo) {
            const timeText = todo.timeStart ? String(todo.timeStart).slice(0, 5) : '';
            const title = 'ถึงเวลางานแล้ว';
            const body = `${timeText ? timeText + ' • ' : ''}${todo.text || 'งาน'}`;

            if ('Notification' in window && Notification.permission === 'granted') {
                try {
                    new Notification(title, {
                        body,
                        requireInteraction: true,
                        silent: false,
                        tag: `todo_${todo.id}`
                    });
                } catch (e) {}
            } else {
                showToast(`🔔 ${body}`);
            }

            if (notificationSoundEnabled && notificationAudioUnlocked) {
                playNotificationBeep(notificationSoundType);
            }
        }

        function processDueTodoNotifications() {
            if (!currentUser) return;
            const now = Date.now();
            const windowMs = 5 * 60 * 1000;
            todos.forEach(todo => {
                const trigger = getTodoTriggerTimeMs(todo);
                if (trigger === null) return;
                if (trigger > now) return;
                if (now - trigger > windowMs) return;
                const key = getTodoNotificationKey(todo);
                if (localStorage.getItem(key)) return;
                localStorage.setItem(key, String(now));
                fireTodoNotification(todo);
            });
        }

        function scheduleNextTodoNotification() {
            if (todoNotificationTimer) {
                clearTimeout(todoNotificationTimer);
                todoNotificationTimer = null;
            }
            if (!currentUser) return;

            processDueTodoNotifications();

            const now = Date.now();
            let nextTime = null;
            let nextTodo = null;

            for (const todo of todos) {
                const trigger = getTodoTriggerTimeMs(todo);
                if (trigger === null) continue;
                if (trigger <= now) continue;
                const key = getTodoNotificationKey(todo);
                if (localStorage.getItem(key)) continue;
                if (nextTime === null || trigger < nextTime) {
                    nextTime = trigger;
                    nextTodo = todo;
                }
            }

            if (nextTime === null || !nextTodo) return;
            const delay = Math.max(0, Math.min(nextTime - now, 2147483647));
            todoNotificationTimer = setTimeout(() => {
                scheduleNextTodoNotification();
            }, delay);
        }

        // Week Plan
        function renderWeekPlan() {
            const container = document.getElementById('weekDays');
            container.innerHTML = '';

            // Start from today, show 5 days ahead
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const dayNames = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

            // Show 5 days starting from today
            for (let i = 0; i < 5; i++) {
                const date = new Date(today);
                date.setDate(today.getDate() + i);
                
                // Use EXACT same format as calendar
                const year = date.getFullYear();
                const month = date.getMonth();
                const day = date.getDate();
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                
                const isToday = i === 0;
                const dayTodos = todos.filter(t => t.dueDate === dateStr && !(t && t.recurring && !t.parentId));
                const dayVisits = branchVisits.filter(v => v.date === dateStr);
                const dayLeaves = leaveDays.filter(l => l && l.date === dateStr);
                const isDayOff = hasDayOffOnDate(dateStr);
                
                const card = document.createElement('div');
                card.className = `week-day-card ${isToday ? 'today' : ''}`;
                
                const dayName = dayNames[date.getDay()];
                
                card.innerHTML = `
                    <div class="week-day-header">
                        <div class="week-day-name">${dayName}${isToday ? ' (วันนี้)' : ''}</div>
                        <div class="week-day-date">${day}/${month + 1}</div>
                    </div>
                    <div class="week-day-todos" id="week-${dateStr}"></div>
                `;

                const todosContainer = card.querySelector('.week-day-todos');
                
                // Show branch visits first (at top)
                if (dayVisits.length > 0) {
                    dayVisits.forEach(visit => {
                        const timeIn = (visit.timeIn || visit.time || '').substring(0, 5);
                        const timeOut = (visit.timeOut || '').substring(0, 5);
                        const timeText = timeOut ? `${timeIn}-${timeOut}` : timeIn;
                        const branchDisplay = visit.branch ? (branchNames[visit.branch] || visit.branch) : '';
                        const visitTitle = visit.branch ? `🏢 ${branchDisplay}` : '🕘 เวลางาน';
                        const visitItem = document.createElement('div');
                        visitItem.className = 'week-branch-visit';
                        visitItem.innerHTML = `
                            <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                                <span>${visit.owner ? `(${getUserDisplayName(visit.owner)}) ` : ''}${visitTitle}</span>
                                <span style="font-size: 0.7rem; opacity: 0.9;">⏰ ${timeText}</span>
                            </div>
                            <div style="display: flex; gap: 4px;">
                                <button class="icon-btn-small" onclick="event.stopPropagation(); editBranchVisit(${visit.id})" title="แก้ไข" style="background: rgba(255,255,255,0.2); color: white; border: none; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">✏️</button>
                                <button class="icon-btn-small" onclick="event.stopPropagation(); deleteBranchVisitFromWeek(${visit.id})" title="ลบ" style="background: rgba(239,68,68,0.8); color: white; border: none; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">🗑️</button>
                            </div>
                        `;
                        todosContainer.appendChild(visitItem);
                    });
                }
                
                // Show day off
                if (isDayOff) {
                    const owners = isAllViewMode() ? getDayOffOwnersForDate(dateStr) : [''];
                    (owners.length ? owners : ['']).forEach(owner => {
                        const dayOffItem = document.createElement('div');
                        dayOffItem.className = 'week-leave-item';
                        dayOffItem.style.background = 'linear-gradient(135deg, #06b6d4, #0891b2)';
                        dayOffItem.innerHTML = `🏖️ ${owner ? `(${getUserDisplayName(owner)}) ` : ''}Day Off`;
                        todosContainer.appendChild(dayOffItem);
                    });
                }
                
                // Show leave days
                if (dayLeaves.length > 0) {
                    dayLeaves.forEach(leave => {
                        const leaveInfo = leaveTypes[leave.type];
                        const leaveItem = document.createElement('div');
                        leaveItem.className = `week-leave-item leave-${leave.type}`;
                        leaveItem.innerHTML = `${leaveInfo.icon} ${leave.owner ? `(${getUserDisplayName(leave.owner)}) ` : ''}${leaveInfo.name}`;
                        todosContainer.appendChild(leaveItem);
                    });
                }
                
                // Then show regular todos
                if (dayTodos.length === 0 && dayVisits.length === 0 && dayLeaves.length === 0 && !isDayOff) {
                    todosContainer.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.8rem; text-align: center; padding: 10px;">ไม่มีงาน</div>';
                } else if (dayTodos.length > 0) {
                    dayTodos.forEach(todo => {
                        const todoItem = document.createElement('div');
                        todoItem.className = 'week-todo-item';
                        const isAllView = currentUser && currentUser.role === 'admin' && viewingUser === 'all';
                        
                        const timeDisplay = todo.timeStart && todo.timeEnd ? 
                            `⏰ ${todo.timeStart}-${todo.timeEnd}` : 
                            (todo.timeStart ? `⏰ ${todo.timeStart}` : '');
                        
                        const branchDisplay = todo.branches && todo.branches.length > 0 ? 
                            `🏢 ${todo.branches.join(', ')}` : '';
                        
                        const iconDisplay = todo.icon ? `${todo.icon} ` : '';
                        
                        const ownerPrefix = todo.owner ? `(${getUserDisplayName(todo.owner)}) ` : '';
                        todoItem.innerHTML = `
                            ${isAllView ? '' : `<div class="week-todo-checkbox ${todo.completed ? 'checked' : ''}" onclick="toggleTodo(${todo.id})"></div>`}
                            <div class="week-todo-content">
                                <div class="week-todo-text ${todo.completed ? 'completed' : ''}">${ownerPrefix}${iconDisplay}${todo.text}</div>
                                <div class="week-todo-meta">
                                    ${branchDisplay}
                                    ${timeDisplay}
                                    <span class="priority-badge priority-${todo.priority}" style="padding: 2px 6px; font-size: 0.7rem;">${getPriorityText(todo.priority)}</span>
                                </div>
                            </div>
                            ${isAllView ? '' : `
                                <div style="display: flex; gap: 4px; margin-left: 8px;">
                                    <button class="icon-btn-small" onclick="event.stopPropagation(); editTodo(${todo.id})" title="แก้ไข" style="background: var(--bg-hover); border: 1px solid var(--border); padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">✏️</button>
                                    <button class="icon-btn-small" onclick="event.stopPropagation(); deleteTodoFromWeek(${todo.id})" title="ลบ" style="background: var(--danger); color: white; border: none; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">🗑️</button>
                                </div>
                            `}
                        `;
                        
                        todosContainer.appendChild(todoItem);
                    });
                }

                container.appendChild(card);
            }
        }

        function refreshWeekPlan() {
            renderWeekPlan();
            updateNotifications();
        }

        function deleteBranchVisitFromWeek(id) {
            if (!canUseBranchVisitNow()) {
                showToast('ไม่มีสิทธิ์บันทึกเวลางาน', 'error');
                return;
            }
            if (!confirm('ต้องการลบเวลางานนี้?')) return;

            branchVisits = branchVisits.filter(v => v.id !== id);
            saveBranchVisits();
            renderCalendar();
            renderWeekPlan();

            showToast('🗑️ ลบเวลางานสำเร็จ');
        }

        function deleteTodoFromWeek(id) {
            deleteTodo(id);
        }

        // Debug Functions
        function showDebugInfo() {
            const panel = document.getElementById('debugPanel');
            const backdrop = document.getElementById('debugBackdrop');
            const content = document.getElementById('debugContent');
            
            let html = '<div style="font-family: monospace;">';
            html += '<table style="width: 100%; border-collapse: collapse;">';
            html += '<thead><tr style="background: var(--primary); color: white;"><th style="padding: 10px; border: 1px solid var(--border);">ID</th><th style="padding: 10px; border: 1px solid var(--border);">งาน</th><th style="padding: 10px; border: 1px solid var(--border);">วันที่บันทึก</th><th style="padding: 10px; border: 1px solid var(--border);">แก้ไข</th></tr></thead>';
            html += '<tbody>';
            
            todos.forEach(todo => {
                html += `<tr style="border: 1px solid var(--border);">`;
                html += `<td style="padding: 10px; border: 1px solid var(--border);">${todo.id}</td>`;
                html += `<td style="padding: 10px; border: 1px solid var(--border);">${todo.text}</td>`;
                html += `<td style="padding: 10px; border: 1px solid var(--border);">`;
                html += `<input type="date" value="${todo.dueDate || ''}" id="date-${todo.id}" style="padding: 5px; border: 2px solid var(--border); border-radius: 5px; background: var(--bg-main); color: var(--text-primary);">`;
                html += `</td>`;
                html += `<td style="padding: 10px; border: 1px solid var(--border);">`;
                html += `<button class="btn btn-primary" onclick="fixTodoDate(${todo.id})" style="padding: 5px 10px;">💾 แก้</button>`;
                html += `</td>`;
                html += `</tr>`;
            });
            
            html += '</tbody></table>';
            html += '<div style="margin-top: 20px; text-align: center;">';
            html += '<button class="btn btn-primary" onclick="closeDebugPanel()" style="padding: 10px 30px;">✓ เสร็จสิ้น</button>';
            html += '</div>';
            html += '</div>';
            
            content.innerHTML = html;
            panel.style.display = 'block';
            backdrop.style.display = 'block';
        }

        function closeDebugPanel() {
            document.getElementById('debugPanel').style.display = 'none';
            document.getElementById('debugBackdrop').style.display = 'none';
        }

        function fixTodoDate(id) {
            const todo = todos.find(t => t.id === id);
            if (!todo) return;
            
            const newDate = document.getElementById(`date-${id}`).value;
            if (!newDate) {
                showToast('กรุณาเลือกวันที่', 'error');
                return;
            }
            
            todo.dueDate = newDate;
            saveTodos();
            renderTodos();
            renderCalendar();
            renderWeekPlan();
            
            showToast(`✅ แก้ไขวันที่งาน "${todo.text}" เป็น ${newDate} สำเร็จ!`);
            
            // Refresh debug panel
            showDebugInfo();
        }

        // Bulk Add Tasks Functions
        function toggleBulkAdd() {
            if (!canManageTodosNow()) {
                showToast('ไม่มีสิทธิ์จัดการงาน', 'error');
                return;
            }
            const container = document.getElementById('bulkAddContainer');
            
            if (container.classList.contains('show')) {
                container.classList.remove('show');
            } else {
                container.classList.add('show');
                // Set default date to today
                document.getElementById('bulkDefaultDate').value = getTodayDateString();
            }
        }

        function parseBulkTask(line) {
            // Remove extra spaces
            line = line.trim();
            if (!line) return null;

            // Parse format: task | priority | category | date | timeStart | timeEnd | icon
            const parts = line.split('|').map(p => p.trim());
            
            // Use selected emoji if no emoji in line
            const taskIcon = parts[6] || selectedBulkEmoji || '';
            
            const task = {
                text: parts[0],
                priority: parts[1] || document.getElementById('bulkDefaultPriority').value,
                category: parts[2] || document.getElementById('bulkDefaultCategory').value,
                dueDate: parts[3] || document.getElementById('bulkDefaultDate').value,
                timeStart: parts[4] || '',
                timeEnd: parts[5] || '',
                icon: taskIcon,
                createdBy: currentUser ? currentUser.username : ''
            };

            // Validate priority
            if (!['low', 'medium', 'high'].includes(task.priority)) {
                task.priority = document.getElementById('bulkDefaultPriority').value;
            }

            // Validate category
            if (!defaultCategoryKeys.includes(task.category)) {
                task.category = document.getElementById('bulkDefaultCategory').value;
            }

            return task;
        }

        function updateBulkPreview() {
            const input = document.getElementById('bulkTaskInput').value;
            const lines = input.split('\n').filter(line => line.trim());
            
            const preview = document.getElementById('bulkPreview');
            const previewList = document.getElementById('bulkPreviewList');
            const count = document.getElementById('bulkCount');
            const addCount = document.getElementById('bulkAddCount');
            
            if (lines.length === 0) {
                preview.style.display = 'none';
                return;
            }

            preview.style.display = 'block';
            previewList.innerHTML = '';
            
            const tasks = lines.map(line => parseBulkTask(line)).filter(t => t !== null);
            bulkTasksCache = tasks;
            count.textContent = tasks.length;

            const needsReset = bulkSelectedIndexes.size === 0 || Array.from(bulkSelectedIndexes).some(i => i < 0 || i >= tasks.length);
            if (needsReset) {
                bulkSelectedIndexes = new Set(tasks.map((_, i) => i));
            }
            addCount.textContent = bulkSelectedIndexes.size;

            const categoryIcons = {
                work: '💼',
                personal: '👤',
                shopping: '🛒',
                health: '💪',
                study: '📚'
            };

            const priorityColors = {
                high: '🔴',
                medium: '🟡',
                low: '🟢'
            };

            tasks.forEach((task, index) => {
                const item = document.createElement('div');
                item.className = 'bulk-preview-item';
                item.style.cursor = 'pointer';
                const timeDisplay = task.timeStart && task.timeEnd ? 
                    `⏰ ${task.timeStart}-${task.timeEnd}` : 
                    (task.timeStart ? `⏰ ${task.timeStart}` : '');
                item.innerHTML = `
                    <input type="checkbox" ${bulkSelectedIndexes.has(index) ? 'checked' : ''} onclick="event.stopPropagation(); toggleBulkSelect(${index}, this.checked)">
                    <span class="icon">${categoryIcons[task.category]}</span>
                    <span class="icon">${priorityColors[task.priority]}</span>
                    <span style="flex: 1;">${task.text}</span>
                    ${task.dueDate ? `<span style="font-size: 0.8rem; color: var(--text-secondary);">📅 ${formatDate(task.dueDate)}${timeDisplay ? ' ' + timeDisplay : ''}</span>` : ''}
                `;
                item.onclick = () => {
                    const checked = !bulkSelectedIndexes.has(index);
                    toggleBulkSelect(index, checked);
                };
                previewList.appendChild(item);
            });
        }

        function toggleBulkSelect(index, checked) {
            if (checked) bulkSelectedIndexes.add(index);
            else bulkSelectedIndexes.delete(index);
            const addCount = document.getElementById('bulkAddCount');
            if (addCount) addCount.textContent = bulkSelectedIndexes.size;
            updateBulkPreviewSelectionUI();
        }

        function updateBulkPreviewSelectionUI() {
            const previewList = document.getElementById('bulkPreviewList');
            if (!previewList) return;
            Array.from(previewList.querySelectorAll('input[type="checkbox"]')).forEach((el, idx) => {
                el.checked = bulkSelectedIndexes.has(idx);
            });
        }

        function addBulkTasks() {
            const input = document.getElementById('bulkTaskInput').value;
            const lines = input.split('\n').filter(line => line.trim());
            
            if (lines.length === 0) {
                showToast('กรุณาพิมพ์งานที่ต้องการเพิ่ม', 'error');
                return;
            }

            const tasks = lines.map(line => parseBulkTask(line)).filter(t => t !== null);
            
            if (tasks.length === 0) {
                showToast('ไม่พบงานที่ถูกต้อง', 'error');
                return;
            }

            const selectedIndexes = Array.from(bulkSelectedIndexes).filter(i => i >= 0 && i < tasks.length);
            if (selectedIndexes.length === 0) {
                showToast('กรุณาเลือกงานที่ต้องการเพิ่ม', 'error');
                return;
            }

            const recurringEnabled = !!(document.getElementById('recurringCheckbox') && document.getElementById('recurringCheckbox').checked);
            const recurringTypeEl = document.getElementById('recurringType');
            const recurringIntervalEl = document.getElementById('recurringInterval');
            const recurringStartEl = document.getElementById('recurringStartDate');
            const recurringEndEl = document.getElementById('recurringEndDate');

            let added = 0;
            const nowIso = new Date().toISOString();

            const addSingleTodo = (taskData, dueDate, id) => {
                const todo = {
                    id,
                    text: taskData.text,
                    completed: false,
                    priority: taskData.priority,
                    category: taskData.category,
                    dueDate: dueDate === null ? null : (dueDate || taskData.dueDate),
                    timeStart: taskData.timeStart,
                    timeEnd: taskData.timeEnd,
                    icon: taskData.icon || '',
                    createdBy: taskData.createdBy || (currentUser ? currentUser.username : ''),
                    createdAt: nowIso
                };
                todos.unshift(todo);
                added++;
                return todo;
            };

            const generateRecurringDatesInRange = (config, startDateStr, endDateStr) => {
                const start = parseDateKeyLocal(startDateStr);
                const end = parseDateKeyLocal(endDateStr);
                if (!start || !end) return [];
                const dates = [];
                const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
                while (cur <= end) {
                    if (shouldGenerateForDate(cur, config)) {
                        dates.push(toDateKey(cur));
                    }
                    cur.setDate(cur.getDate() + 1);
                }
                return dates;
            };

            const addRecurringSeries = (taskData, baseIndex) => {
                const type = recurringTypeEl ? recurringTypeEl.value : 'daily';
                const interval = recurringIntervalEl ? (parseInt(recurringIntervalEl.value) || 1) : 1;
                const uiStartDate = recurringStartEl ? recurringStartEl.value : '';
                const bulkDefaultDate = document.getElementById('bulkDefaultDate') ? document.getElementById('bulkDefaultDate').value : '';
                const startDateStr = uiStartDate || bulkDefaultDate || getTodayDateString();
                const endDateStrRaw = recurringEndEl ? recurringEndEl.value : '';

                if ((type === 'weekly' || type === 'custom') && (!Array.isArray(selectedWeekdays) || selectedWeekdays.length === 0)) {
                    showToast('กรุณาเลือกวันที่ต้องการทำซ้ำ', 'error');
                    return;
                }

                const parentId = Date.now() + baseIndex + Math.random();
                const recurring = {
                    type,
                    interval,
                    startDate: startDateStr,
                    endDate: endDateStrRaw || null,
                    monthlyDay: type === 'monthly' ? (document.getElementById('recurringMonthlyDay') ? document.getElementById('recurringMonthlyDay').value : undefined) : undefined,
                    weekdays: (type === 'weekly' || type === 'custom') ? [...selectedWeekdays].sort() : undefined,
                    lastGenerated: null
                };

                const parent = addSingleTodo(taskData, null, parentId);
                parent.recurring = recurring;
                parent.completed = false;

                const dates = (() => {
                    if (endDateStrRaw) {
                        return generateRecurringDatesInRange(recurring, startDateStr, endDateStrRaw);
                    }
                    return [startDateStr];
                })();

                Array.from(new Set(dates)).forEach((dateStr, i) => {
                    const id = Date.now() + baseIndex + i + Math.random();
                    const instance = addSingleTodo(taskData, dateStr, id);
                    instance.parentId = parentId;
                    delete instance.recurring;
                    instance.completed = false;
                });
            };

            selectedIndexes.forEach((index, idx) => {
                const taskData = tasks[index];
                if (!taskData) return;
                if (recurringEnabled) {
                    addRecurringSeries(taskData, index + idx);
                } else {
                    addSingleTodo(taskData, taskData.dueDate, Date.now() + index + Math.random());
                }
            });

            saveTodos();
            updateSidebarCounts();
            renderTodos();
            updateStats();
            updateNotifications();
            renderWeekPlan();
            if (currentView === 'calendar') {
                renderCalendar();
            }

            // Clear form
            document.getElementById('bulkTaskInput').value = '';
            document.getElementById('bulkAddContainer').classList.remove('show');
            updateBulkPreview();

            showToast(`✅ เพิ่มงานสำเร็จ ${added} รายการ!`);
        }

        function clearBulkInput() {
            document.getElementById('bulkTaskInput').value = '';
            updateBulkPreview();
        }

        // Recurring Task Functions
        function toggleRecurringOptions() {
            const checkbox = document.getElementById('recurringCheckbox');
            const options = document.getElementById('recurringOptions');
            
            checkbox.checked = !checkbox.checked;
            
            if (checkbox.checked) {
                options.classList.add('show');
                setDefaultRecurringDates();
                updateRecurringConfig();
            } else {
                options.classList.remove('show');
            }
        }

        function setDefaultRecurringDates() {
            document.getElementById('recurringStartDate').value = getTodayDateString();
        }

        function updateRecurringConfig() {
            const type = document.getElementById('recurringType').value;
            const weekdayField = document.getElementById('weekdayField');
            const intervalField = document.getElementById('intervalField');
            const monthlyDayField = document.getElementById('monthlyDayField');
            
            // Reset weekday selection
            selectedWeekdays = [];
            document.querySelectorAll('.weekday-btn').forEach(btn => btn.classList.remove('selected'));
            
            if (type === 'custom') {
                weekdayField.style.display = 'block';
                intervalField.style.display = 'block';
                if (monthlyDayField) monthlyDayField.style.display = 'none';
            } else if (type === 'weekly') {
                weekdayField.style.display = 'block';
                intervalField.style.display = 'block';
                if (monthlyDayField) monthlyDayField.style.display = 'none';
            } else if (type === 'monthly') {
                weekdayField.style.display = 'none';
                intervalField.style.display = 'block';
                if (monthlyDayField) {
                    monthlyDayField.style.display = 'block';
                    const startEl = document.getElementById('recurringStartDate');
                    const startDate = parseDateKeyLocal(startEl ? startEl.value : '');
                    const day = startDate ? String(startDate.getDate()) : '1';
                    const daySelect = document.getElementById('recurringMonthlyDay');
                    if (daySelect) daySelect.value = day;
                }
            } else if (type === 'weekdays') {
                weekdayField.style.display = 'none';
                intervalField.style.display = 'none';
                if (monthlyDayField) monthlyDayField.style.display = 'none';
                selectedWeekdays = [1, 2, 3, 4, 5]; // Mon-Fri
            } else if (type === 'weekends') {
                weekdayField.style.display = 'none';
                intervalField.style.display = 'none';
                if (monthlyDayField) monthlyDayField.style.display = 'none';
                selectedWeekdays = [0, 6]; // Sun, Sat
            } else {
                weekdayField.style.display = 'none';
                intervalField.style.display = 'block';
                if (monthlyDayField) monthlyDayField.style.display = 'none';
            }
            
            updateRecurringPreview();
        }

        function toggleWeekday(day) {
            const index = selectedWeekdays.indexOf(day);
            const btn = document.querySelector(`.weekday-btn[data-day="${day}"]`);
            
            if (index > -1) {
                selectedWeekdays.splice(index, 1);
                btn.classList.remove('selected');
            } else {
                selectedWeekdays.push(day);
                btn.classList.add('selected');
            }
            
            updateRecurringPreview();
        }

        function updateRecurringPreview() {
            const type = document.getElementById('recurringType').value;
            const interval = parseInt(document.getElementById('recurringInterval').value) || 1;
            const previewText = document.getElementById('recurringPreviewText');
            
            let text = '';
            const dayNames = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
            
            switch(type) {
                case 'daily':
                    text = interval === 1 ? 'งานนี้จะทำซ้ำทุกวัน' : `งานนี้จะทำซ้ำทุก ${interval} วัน`;
                    break;
                case 'weekly':
                    if (selectedWeekdays.length > 0) {
                        const days = selectedWeekdays.sort().map(d => dayNames[d]).join(', ');
                        text = interval === 1 ? 
                            `งานนี้จะทำซ้ำทุกสัปดาห์ในวัน: ${days}` :
                            `งานนี้จะทำซ้ำทุก ${interval} สัปดาห์ในวัน: ${days}`;
                    } else {
                        text = 'กรุณาเลือกวันที่ต้องการ';
                    }
                    break;
                case 'monthly':
                    {
                        const md = document.getElementById('recurringMonthlyDay');
                        const v = md ? md.value : '';
                        const dayText = v === 'last' ? 'สิ้นเดือน' : `วันที่ ${v || '1'}`;
                        text = interval === 1 ? `งานนี้จะทำซ้ำทุกเดือน (${dayText})` : `งานนี้จะทำซ้ำทุก ${interval} เดือน (${dayText})`;
                    }
                    break;
                case 'weekdays':
                    text = 'งานนี้จะทำซ้ำทุกวันจันทร์-ศุกร์';
                    break;
                case 'weekends':
                    text = 'งานนี้จะทำซ้ำทุกวันเสาร์-อาทิตย์';
                    break;
                case 'custom':
                    if (selectedWeekdays.length > 0) {
                        const days = selectedWeekdays.sort().map(d => dayNames[d]).join(', ');
                        text = `งานนี้จะทำซ้ำในวัน: ${days}`;
                    } else {
                        text = 'กรุณาเลือกวันที่ต้องการ';
                    }
                    break;
            }
            
            previewText.textContent = text;
        }

        function getRecurringText(recurring) {
            if (!recurring) return '';
            
            const type = recurring.type;
            const interval = recurring.interval;
            
            switch(type) {
                case 'daily':
                    return interval === 1 ? 'ทุกวัน' : `ทุก ${interval} วัน`;
                case 'weekly':
                    return interval === 1 ? 'ทุกสัปดาห์' : `ทุก ${interval} สัปดาห์`;
                case 'monthly':
                    if (recurring.monthlyDay === 'last') return interval === 1 ? 'สิ้นเดือน' : `ทุก ${interval} เดือน (สิ้นเดือน)`;
                    if (recurring.monthlyDay) return interval === 1 ? `ทุกเดือน (${recurring.monthlyDay})` : `ทุก ${interval} เดือน (${recurring.monthlyDay})`;
                    return interval === 1 ? 'ทุกเดือน' : `ทุก ${interval} เดือน`;
                case 'weekdays':
                    return 'จ-ศ';
                case 'weekends':
                    return 'ส-อา';
                case 'custom':
                    return 'กำหนดเอง';
                default:
                    return 'ทำซ้ำ';
            }
        }

        function generateRecurringTasks() {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayStr = toDateKey(today);
            
            // Find all recurring parent tasks
            const recurringParents = todos.filter(t => t.recurring && !t.parentId);
            
            recurringParents.forEach(parent => {
                const config = parent.recurring;
                
                // Check if we need to generate for today
                if (config.lastGenerated === todayStr) return;
                
                // Check if today is within the recurring range
                const startDate = parseDateKeyLocal(config.startDate);
                if (!startDate) return;
                
                if (today < startDate) return;
                
                if (config.endDate) {
                    const endDate = parseDateKeyLocal(config.endDate);
                    if (!endDate) return;
                    if (today > endDate) return;
                }
                
                // Check if today matches the recurring pattern
                if (shouldGenerateForDate(today, config)) {
                    // Check if instance already exists for today
                    const existingInstance = todos.find(t => 
                        t.parentId === parent.id && t.dueDate === todayStr
                    );
                    
                    if (!existingInstance) {
                        // Create new instance
                        const instance = {
                            ...parent,
                            id: Date.now() + Math.random(),
                            dueDate: todayStr,
                            parentId: parent.id,
                            completed: false,
                            createdAt: new Date().toISOString()
                        };
                        
                        delete instance.recurring; // Instances don't have recurring config
                        todos.push(instance);
                    }
                }
                
                // Update last generated date
                parent.recurring.lastGenerated = todayStr;
            });
            
            saveTodos();
        }

        function shouldGenerateForDate(date, config) {
            const dayOfWeek = date.getDay();
            
            switch(config.type) {
                case 'daily':
                    const startDate = parseDateKeyLocal(config.startDate);
                    if (!startDate) return false;
                    const daysDiff = Math.floor((date - startDate) / (1000 * 60 * 60 * 24));
                    return daysDiff % config.interval === 0;
                    
                case 'weekly':
                    if (!config.weekdays || config.weekdays.length === 0) return false;
                    {
                        const startDate = parseDateKeyLocal(config.startDate);
                        if (!startDate) return false;
                        const daysDiff = Math.floor((date - startDate) / (1000 * 60 * 60 * 24));
                        const weeksDiff = Math.floor(daysDiff / 7);
                        if (weeksDiff % (config.interval || 1) !== 0) return false;
                        return config.weekdays.includes(dayOfWeek);
                    }
                    
                case 'monthly':
                    {
                        const startDate = parseDateKeyLocal(config.startDate);
                        if (!startDate) return false;
                        const monthsDiff = (date.getFullYear() - startDate.getFullYear()) * 12 + (date.getMonth() - startDate.getMonth());
                        if (monthsDiff % (config.interval || 1) !== 0) return false;
                        const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
                        const md = config.monthlyDay;
                        if (md === 'last') return date.getDate() === lastDay;
                        const numericDay = md ? parseInt(md) : startDate.getDate();
                        const targetDay = Math.min(Math.max(1, numericDay || startDate.getDate()), lastDay);
                        return date.getDate() === targetDay;
                    }
                    
                case 'weekdays':
                    return dayOfWeek >= 1 && dayOfWeek <= 5;
                    
                case 'weekends':
                    return dayOfWeek === 0 || dayOfWeek === 6;
                    
                case 'custom':
                    if (!config.weekdays || config.weekdays.length === 0) return false;
                    {
                        const startDate = parseDateKeyLocal(config.startDate);
                        if (!startDate) return false;
                        const daysDiff = Math.floor((date - startDate) / (1000 * 60 * 60 * 24));
                        const weeksDiff = Math.floor(daysDiff / 7);
                        if (weeksDiff % (config.interval || 1) !== 0) return false;
                        return config.weekdays.includes(dayOfWeek);
                    }
                    
                default:
                    return false;
            }
        }

        // ========================================
        // ENHANCED FEATURES - 15 NEW FEATURES
        // ========================================

        // 1. 🔍 SEARCH FUNCTION
        function searchTodos() {
            const searchTerm = document.getElementById('searchInput').value.toLowerCase();
            const clearBtn = document.getElementById('clearSearchBtn');
            
            if (searchTerm) {
                clearBtn.style.display = 'block';
            } else {
                clearBtn.style.display = 'none';
            }
            
            renderTodos(searchTerm);
        }

        function clearSearch() {
            document.getElementById('searchInput').value = '';
            document.getElementById('clearSearchBtn').style.display = 'none';
            renderTodos();
        }

        // 2. 📝 NOTES FEATURE
        function addNoteToTodo(id) {
            const todo = todos.find(t => t.id === id);
            if (!todo) return;
            
            const note = prompt('เพิ่มบันทึก:', todo.notes || '');
            if (note !== null) {
                todo.notes = note;
                saveTodos();
                refreshAllViews();
                showToast('✅ บันทึกโน้ตสำเร็จ!');
            }
        }

        // 3. 📌 PIN FEATURE
        function togglePin(id) {
            const todo = todos.find(t => t.id === id);
            if (todo) {
                todo.pinned = !todo.pinned;
                saveTodos();
                refreshAllViews();
                showToast(todo.pinned ? '📌 ปักหมุดแล้ว!' : '📌 ยกเลิกปักหมุด');
            }
        }

        // 4. 🏷️ TAGS FEATURE
        function addTagToTodo(id) {
            const todo = todos.find(t => t.id === id);
            if (!todo) return;
            
            const tag = prompt('เพิ่มแท็ก (คั่นด้วย , สำหรับหลายแท็ก):', 
                (todo.tags || []).join(', '));
            
            if (tag !== null) {
                todo.tags = tag.split(',').map(t => t.trim()).filter(t => t);
                saveTodos();
                refreshAllViews();
                showToast('🏷️ เพิ่มแท็กสำเร็จ!');
            }
        }

        // 5. 📎 LINKS FEATURE
        function addLinkToTodo(id) {
            const todo = todos.find(t => t.id === id);
            if (!todo) return;
            
            const link = prompt('เพิ่มลิงก์:', todo.link || '');
            if (link !== null) {
                todo.link = link;
                saveTodos();
                refreshAllViews();
                showToast('📎 เพิ่มลิงก์สำเร็จ!');
            }
        }

        // 6. 📊 PROGRESS BAR (Sub-tasks)
        function addSubTask(id) {
            const todo = todos.find(t => t.id === id);
            if (!todo) return;
            
            const subTaskText = prompt('เพิ่มงานย่อย:');
            if (subTaskText && subTaskText.trim()) {
                if (!todo.subTasks) todo.subTasks = [];
                todo.subTasks.push({
                    id: Date.now(),
                    text: subTaskText.trim(),
                    completed: false
                });
                saveTodos();
                refreshAllViews();
                showToast('✅ เพิ่มงานย่อยสำเร็จ!');
            }
        }

        function toggleSubTask(todoId, subTaskId) {
            const todo = todos.find(t => t.id === todoId);
            if (!todo || !todo.subTasks) return;
            
            const subTask = todo.subTasks.find(st => st.id === subTaskId);
            if (subTask) {
                subTask.completed = !subTask.completed;
                saveTodos();
                refreshAllViews();
            }
        }

        function getProgress(todo) {
            if (!todo.subTasks || todo.subTasks.length === 0) return 0;
            const completed = todo.subTasks.filter(st => st.completed).length;
            return Math.round((completed / todo.subTasks.length) * 100);
        }

        // 7. ⏱️ TIMER/POMODORO
        let timerInterval = null;
        let timerTodoId = null;
        let timerSeconds = 0;

        function startTimer(id) {
            if (timerInterval) {
                showToast('⏱️ กำลังจับเวลางานอื่นอยู่!', 'error');
                return;
            }
            
            const todo = todos.find(t => t.id === id);
            if (!todo) return;
            
            timerTodoId = id;
            timerSeconds = todo.timerSeconds || 0;
            
            timerInterval = setInterval(() => {
                timerSeconds++;
                todo.timerSeconds = timerSeconds;
                saveTodos();
                updateTimerDisplay(id);
            }, 1000);
            
            showToast('⏱️ เริ่มจับเวลา!');
            refreshAllViews();
        }

        function stopTimer(id) {
            if (timerInterval && timerTodoId === id) {
                clearInterval(timerInterval);
                timerInterval = null;
                timerTodoId = null;
                showToast('⏱️ หยุดจับเวลา!');
                refreshAllViews();
            }
        }

        function resetTimer(id) {
            const todo = todos.find(t => t.id === id);
            if (!todo) return;
            
            if (confirm('ต้องการรีเซ็ตเวลา?')) {
                todo.timerSeconds = 0;
                timerSeconds = 0;
                saveTodos();
                refreshAllViews();
                showToast('⏱️ รีเซ็ตเวลาแล้ว!');
            }
        }

        function updateTimerDisplay(id) {
            const display = document.getElementById(`timer-${id}`);
            if (display) {
                const todo = todos.find(t => t.id === id);
                const seconds = todo?.timerSeconds || 0;
                const hours = Math.floor(seconds / 3600);
                const mins = Math.floor((seconds % 3600) / 60);
                const secs = seconds % 60;
                display.textContent = `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            }
        }

        // 8. 🎨 COLOR LABELS
        function setColorLabel(id) {
            const todo = todos.find(t => t.id === id);
            if (!todo) return;
            
            const colors = {
                '': 'ไม่มีสี',
                '#ef4444': '🔴 แดง',
                '#f59e0b': '🟡 เหลือง',
                '#10b981': '🟢 เขียว',
                '#3b82f6': '🔵 น้ำเงิน',
                '#8b5cf6': '🟣 ม่วง',
                '#ec4899': '🩷 ชมพู'
            };
            
            let colorOptions = '';
            Object.entries(colors).forEach(([value, label]) => {
                const selected = todo.colorLabel === value ? 'selected' : '';
                colorOptions += `<option value="${value}" ${selected}>${label}</option>`;
            });
            
            const select = document.createElement('select');
            select.innerHTML = colorOptions;
            select.style.cssText = 'padding: 8px; font-size: 1rem; border-radius: 8px;';
            
            const result = prompt('เลือกสี (0=ไม่มี 1=แดง 2=เหลือง 3=เขียว 4=น้ำเงิน 5=ม่วง 6=ชมพู):');
            if (result !== null) {
                const colorKeys = ['', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
                const colorIndex = parseInt(result);
                if (colorIndex >= 0 && colorIndex < colorKeys.length) {
                    todo.colorLabel = colorKeys[colorIndex];
                    saveTodos();
                    refreshAllViews();
                    showToast('🎨 ตั้งค่าสีสำเร็จ!');
                }
            }
        }

        // 9. 👥 ASSIGN FEATURE
        function assignTodo(id) {
            const todo = todos.find(t => t.id === id);
            if (!todo) return;
            
            const assignee = prompt('มอบหมายให้:', todo.assignee || '');
            if (assignee !== null) {
                todo.assignee = assignee;
                saveTodos();
                refreshAllViews();
                showToast('👥 มอบหมายงานสำเร็จ!');
            }
        }

        // 10. 📤 EXPORT TO CSV
        function exportToCSV() {
            if (!canExportNow()) {
                showToast('ไม่มีสิทธิ์ Export', 'error');
                return;
            }
            let csv = 'เจ้าของข้อมูล,ผู้บันทึกงาน,งาน,สถานะ,ความสำคัญ,หมวดหมู่,วันที่,เวลาเริ่ม,เวลาสิ้นสุด,สาขา,ผู้รับผิดชอบ,โน้ต,แท็ก\n';
            
            todos.forEach(todo => {
                const row = [
                    `"${todo.owner || ''}"`,
                    `"${todo.createdBy || ''}"`,
                    `"${todo.text}"`,
                    todo.completed ? 'เสร็จแล้ว' : 'ยังไม่เสร็จ',
                    todo.priority === 'high' ? 'สูง' : todo.priority === 'medium' ? 'ปานกลาง' : 'ต่ำ',
                    todo.category || '-',
                    todo.dueDate || '-',
                    todo.timeStart || '-',
                    todo.timeEnd || '-',
                    (todo.branches || []).join(';') || '-',
                    todo.assignee || '-',
                    `"${(todo.notes || '').replace(/"/g, '""')}"`,
                    (todo.tags || []).join(';') || '-'
                ].join(',');
                csv += row + '\n';
            });
            
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `todos_${getTodayDateString()}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            showToast('📤 Export สำเร็จ!');
        }

        // 11. 📊 STATISTICS MODAL
        function showStatsModal() {
            const total = todos.length;
            const completed = todos.filter(t => t.completed).length;
            const pending = total - completed;
            const high = todos.filter(t => t.priority === 'high').length;
            const medium = todos.filter(t => t.priority === 'medium').length;
            const low = todos.filter(t => t.priority === 'low').length;
            
            const today = getTodayDateString();
            const todayTodos = todos.filter(t => t.dueDate === today);
            const overdue = todos.filter(t => t.dueDate && t.dueDate < today && !t.completed).length;
            
            const avgCompletion = total > 0 ? Math.round((completed / total) * 100) : 0;
            
            let message = `📊 สถิติการทำงาน\n\n`;
            message += `งานทั้งหมด: ${total}\n`;
            message += `✅ เสร็จแล้ว: ${completed} (${avgCompletion}%)\n`;
            message += `⏳ ค้างอยู่: ${pending}\n`;
            message += `⚠️ เลยกำหนด: ${overdue}\n`;
            message += `📅 งานวันนี้: ${todayTodos.length}\n\n`;
            message += `ความสำคัญ:\n`;
            message += `🔴 สูง: ${high}\n`;
            message += `🟡 ปานกลาง: ${medium}\n`;
            message += `🟢 ต่ำ: ${low}`;
            
            alert(message);
        }

        // 12. ✅ TOGGLE ALL COMPLETED
        function toggleAllCompleted() {
            if (!canManageTodosNow()) {
                showToast('ไม่มีสิทธิ์จัดการงาน', 'error');
                return;
            }
            const allCompleted = todos.filter(t => !t.completed).length === 0;
            
            if (allCompleted) {
                todos.forEach(t => t.completed = false);
                showToast('🔄 ยกเลิกเครื่องหมายทั้งหมด!');
            } else {
                if (confirm('ต้องการทำเครื่องหมายงานทั้งหมดว่าเสร็จแล้ว?')) {
                    todos.forEach(t => t.completed = true);
                    showToast('✅ ทำเครื่องหมายทั้งหมดแล้ว!');
                } else {
                    return;
                }
            }
            
            saveTodos();
            refreshAllViews();
        }

        // 13. 🔔 REMINDER (Browser Notification)
        function requestNotificationPermission() {
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }
        }

        function checkReminders() {
            if ('Notification' in window && Notification.permission === 'granted') {
                const now = new Date();
                const nowStr = now.toISOString();
                
                todos.forEach(todo => {
                    if (!todo.completed && todo.dueDate && !todo.reminded) {
                        const dueDateTime = new Date(todo.dueDate + 'T' + (todo.timeStart || '09:00'));
                        const diff = dueDateTime - now;
                        
                        // Remind 1 hour before
                        if (diff > 0 && diff <= 3600000) { // 1 hour
                            new Notification('⏰ งานใกล้ถึงกำหนด!', {
                                body: `${todo.text}\nเวลา: ${todo.timeStart || 'ไม่ระบุ'}`,
                                icon: '📋'
                            });
                            todo.reminded = true;
                            saveTodos();
                        }
                    }
                });
            }
        }

        // 14. ⭐ ENHANCED PRIORITY VISUAL (already improved in render)
        
        // 15. 🔄 SORT FUNCTIONS
        let currentSort = 'default';
        
        function sortTodos(type) {
            currentSort = type;
            renderTodos();
        }

        function applySorting(todoList) {
            switch(currentSort) {
                case 'priority':
                    return todoList.sort((a, b) => {
                        const priorityOrder = { high: 3, medium: 2, low: 1 };
                        return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
                    });
                case 'date':
                    return todoList.sort((a, b) => {
                        if (!a.dueDate) return 1;
                        if (!b.dueDate) return -1;
                        return a.dueDate.localeCompare(b.dueDate);
                    });
                case 'name':
                    return todoList.sort((a, b) => a.text.localeCompare(b.text));
                case 'category':
                    return todoList.sort((a, b) => (a.category || '').localeCompare(b.category || ''));
                default:
                    // Pin to top, then by creation date
                    return todoList.sort((a, b) => {
                        if (a.pinned && !b.pinned) return -1;
                        if (!a.pinned && b.pinned) return 1;
                        return b.id - a.id;
                    });
            }
        }

        // ========================================
        // END OF ENHANCED FEATURES
        // ========================================

        let activeUserPermissions = null;

        // User Management Functions
        function checkUserPermissions() {
            if (!currentUser) return;
            
            const perms = currentUser.permissions || {
                branch_visit: currentUser.role === 'admin',
                manage_todo: true,
                export_data: currentUser.role === 'admin'
            };
            if (currentUser.role === 'admin') {
                perms.branch_visit = true;
            } else {
                perms.branch_visit = typeof perms.branch_visit === 'boolean' ? perms.branch_visit : false;
            }
            activeUserPermissions = perms;
            
            // 1. Branch Visit Section
            const branchVisitSection = document.getElementById('branchVisitSection');
            if (branchVisitSection) {
                branchVisitSection.style.display = perms.branch_visit ? 'block' : 'none';
            }
            
            // 2. Settings User Section (Admin Only)
            const settingsUserSection = document.getElementById('settingsUserSection');
            if (settingsUserSection) {
                settingsUserSection.style.display = currentUser.role === 'admin' ? 'block' : 'none';
            }

            // Discord section (Admin Only)
            const settingsDiscordSection = document.getElementById('settingsDiscordSection');
            if (settingsDiscordSection) {
                settingsDiscordSection.style.display = currentUser.role === 'admin' ? 'block' : 'none';
            }
            
            // 3. Export Buttons
            const exportBtns = document.querySelectorAll('button[onclick*="export"], div[onclick*="export"]');
            exportBtns.forEach(btn => {
                if (btn.classList.contains('sidebar-item')) {
                     btn.style.display = perms.export_data ? 'flex' : 'none';
                } else {
                     btn.style.display = perms.export_data ? 'inline-block' : 'none';
                }
            });
            const exportSidebarItem = document.querySelector('.sidebar-item[onclick="toggleExportMenu()"]');
            if (exportSidebarItem) exportSidebarItem.style.display = perms.export_data ? 'flex' : 'none';

            // 4. Manage Todo (Add/Edit)
            const todoInputSection = document.getElementById('todoInputSection');
            if (todoInputSection) {
                todoInputSection.style.display = perms.manage_todo ? 'flex' : 'none';
            }
            const bulkAddContainer = document.getElementById('bulkAddContainer');
            if (bulkAddContainer && !perms.manage_todo) {
                bulkAddContainer.classList.remove('show');
            }
            const toggleAllCompletedBtn = document.querySelector('button[onclick="toggleAllCompleted()"]');
            if (toggleAllCompletedBtn) toggleAllCompletedBtn.style.display = perms.manage_todo ? 'inline-block' : 'none';
            const clearCompletedSidebarItem = document.querySelector('.sidebar-item[onclick="clearCompleted()"]');
            if (clearCompletedSidebarItem) clearCompletedSidebarItem.style.display = perms.manage_todo ? 'flex' : 'none';
            
            // Update Admin Controls on Main Page
            updateAdminViewSelector();
            applyRoleVisibility();
        }

        let editingPermissionsUser = null;

        function openUserPermissionsModal(username) {
            const user = users.find(u => u.username === username);
            if (!user) return;
            
            editingPermissionsUser = username;
            document.getElementById('permissionsUsername').textContent = username;
            
            const perms = user.permissions || {
                branch_visit: user.role === 'admin',
                manage_todo: true,
                export_data: user.role === 'admin'
            };
            
            document.getElementById('perm_branch_visit').checked = !!perms.branch_visit;
            document.getElementById('perm_manage_todo').checked = !!perms.manage_todo;
            document.getElementById('perm_export_data').checked = !!perms.export_data;
            
            document.getElementById('userPermissionsModal').classList.add('active');
        }

        function closeUserPermissionsModal(e) {
            if (!e || e.target.id === 'userPermissionsModal' || e.target.classList.contains('close-btn')) {
                 document.getElementById('userPermissionsModal').classList.remove('active');
            }
        }

        function saveUserPermissions() {
            if (!editingPermissionsUser) return;
            
            const userIndex = users.findIndex(u => u.username === editingPermissionsUser);
            if (userIndex === -1) return;
            
            const perms = {
                branch_visit: document.getElementById('perm_branch_visit').checked,
                manage_todo: document.getElementById('perm_manage_todo').checked,
                export_data: document.getElementById('perm_export_data').checked
            };
            
            users[userIndex].permissions = perms;
            saveUsers();
            
            showToast(`บันทึกสิทธิ์เรียบร้อย`);
            document.getElementById('userPermissionsModal').classList.remove('active');
            
            if (currentUser && currentUser.username === editingPermissionsUser) {
                currentUser.permissions = perms;
                sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
                checkUserPermissions();
            }
        }

        function openUserManagementModal() {
            document.getElementById('userManagementModal').classList.add('active');
            renderUserList();
        }

        function closeUserManagementModal(e) {
            if (!e || e.target.id === 'userManagementModal' || e.target.classList.contains('close-btn')) {
                 document.getElementById('userManagementModal').classList.remove('active');
            }
        }

        function renderUserList() {
            const tbody = document.getElementById('userListBody');
            tbody.innerHTML = '';
            
            users.forEach(u => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid var(--border)';
                
                let actions = '';
                // Edit Permissions Button
                actions += `<button onclick="openUserPermissionsModal('${u.username}')" style="background: var(--primary); color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; margin-right: 5px;" title="กำหนดสิทธิ์">🔒</button>`;
                
                // Delete Button
                if (u.username !== 'admin' && u.username !== currentUser.username) {
                    actions += `<button onclick="deleteUser('${u.username}')" style="background: var(--danger); color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer;">ลบ</button>`;
                }

                const usernameTd = document.createElement('td');
                usernameTd.style.padding = '10px';
                usernameTd.textContent = u.username;

                const displayNameTd = document.createElement('td');
                displayNameTd.style.padding = '10px';
                const input = document.createElement('input');
                input.type = 'text';
                input.value = (u.displayName || u.username);
                input.placeholder = 'ชื่อเล่น';
                input.style.width = '100%';
                input.style.padding = '6px 8px';
                input.style.borderRadius = '6px';
                input.style.border = '1px solid var(--border)';
                input.style.background = 'var(--bg-main)';
                input.style.color = 'var(--text-primary)';
                input.onblur = () => updateUserDisplayName(u.username, input.value);
                input.onkeypress = (e) => {
                    if (e.key === 'Enter') input.blur();
                };
                displayNameTd.appendChild(input);

                const roleTd = document.createElement('td');
                roleTd.style.padding = '10px';
                roleTd.innerHTML = `
                    <span class="priority-badge priority-${u.role === 'admin' ? 'high' : 'low'}" style="font-size: 0.8rem;">
                        ${u.role}
                    </span>
                `;

                const actionTd = document.createElement('td');
                actionTd.style.padding = '10px';
                actionTd.style.textAlign = 'right';
                actionTd.innerHTML = actions;

                tr.appendChild(usernameTd);
                tr.appendChild(displayNameTd);
                tr.appendChild(roleTd);
                tr.appendChild(actionTd);
                tbody.appendChild(tr);
            });
        }

        function updateUserDisplayName(username, displayName) {
            const userIndex = users.findIndex(u => u.username === username);
            if (userIndex === -1) return;
            const trimmed = (displayName || '').trim();
            users[userIndex].displayName = trimmed || username;
            saveUsers();
            updateAdminViewSelector();
            renderUserList();
        }

        function addUser() {
            const usernameInput = document.getElementById('newUsername');
            const displayNameInput = document.getElementById('newDisplayName');
            const passwordInput = document.getElementById('newPassword');
            const roleInput = document.getElementById('newUserRole');
            
            const username = usernameInput.value.trim();
            const displayName = (displayNameInput ? displayNameInput.value.trim() : '') || username;
            const password = passwordInput.value.trim();
            const role = roleInput.value;
            
            if (!username || !password) {
                showToast('กรุณากรอกข้อมูลให้ครบ', 'error');
                return;
            }
            
            if (users.some(u => u.username === username)) {
                showToast('ชื่อผู้ใช้นี้มีอยู่แล้ว', 'error');
                return;
            }
            
            users.push({ username, displayName, password, role });
            saveUsers();
            renderUserList();
            
            usernameInput.value = '';
            if (displayNameInput) displayNameInput.value = '';
            passwordInput.value = '';
            
            showToast(`เพิ่มผู้ใช้ ${username} สำเร็จ`);
            
            updateAdminViewSelector();
        }

        function deleteUser(username) {
            if (!confirm(`ต้องการลบผู้ใช้ ${username}?`)) return;
            
            users = users.filter(u => u.username !== username);
            saveUsers();
            renderUserList();
            showToast(`ลบผู้ใช้ ${username} สำเร็จ`);
            
            updateAdminViewSelector();
        }

        // Initialize on load
        window.addEventListener('load', init);
