(function(){
    angular.module('proctor')
        .service('wsData', function($location, TestSession, DateTimeService, WS, Polling, i18n) {

            var self = this;

            this.attempts = [];
            this.counters = {
                created: 0,
                submitted: 0,
                final: 0,
                notFinal: 0
            };
            this.finalStatuses = ['verified', 'rejected', 'error', 'deleted_in_edx', 'timed_out'];

            var updateStatus = function (code, status, updated) {
                var obj = self.attempts.filterBy({code: code});
                if (obj.length > 0) {
                    obj[0]['btnDisabled'] = false;
                    if ((obj[0].review_sent !== true)
                      && (!obj[0]['status_updated'] || !updated || (updated > obj[0]['status_updated']))
                      && (obj[0]['status'] !== status)) {
                        obj[0]['status'] = status;
                        obj[0]['status_updated'] = updated;
                        return true;
                    }
                }
                return false;
            };

            var addAttempt = function (attempt) {
                if (!attempt.hasOwnProperty('comments')) {
                    attempt.comments = [];
                }
                if (!attempt.hasOwnProperty('user_sessions')) {
                    attempt.user_sessions = [];
                }
                var item = self.attempts.filterBy({code: attempt.examCode});
                item = item.length ? item[0] : null;
                if (!item) {
                    self.attempts.push(angular.copy(attempt));
                    Polling.add_item(attempt.examCode);
                    return true;
                }
                return false;
            };

            var recievedUserSession = function (msg) {
                var item = self.attempts.filterBy({code: msg.code});
                item = item.length ? item[0] : null;
                if (item) {
                    var found = item.user_sessions.filterBy({timestamp: msg.data.timestamp});
                    if (!found.length) {
                        msg.data.datetime = moment.unix(msg.data.timestamp).format('DD.MM.YYYY HH:mm');
                        item.user_sessions.push(msg.data);
                        self.updateSuspiciousInfo(item);
                    }
                }
            };

            var recievedComments = function (msg) {
                var item = self.attempts.filterBy({code: msg.code});
                item = item.length ? item[0] : null;
                if (item) {
                    var comment = item.comments.filterBy({timestamp: msg.comments.timestamp});
                    if (!comment.length) {
                        item.comments.push(msg.comments);
                    }
                }
            };

            var pollStatus = function (msg, onAttemptStatusUpdateCallback) {
                var item = self.attempts.filterBy({code: msg.code});
                item = item.length ? item[0] : null;
                var prevStatus = item ? item.status : null;
                if (msg.status === 'started' && item && item.status === 'ready_to_start') {
                    // variable to display in view
                    item.started_at = moment(msg.actual_start_date).format('HH:mm');
                }
                if (msg.actual_end_date) {
                    item.finished_at = moment(msg.actual_end_date).format('HH:mm');
                }
                var updated = updateStatus(msg['code'], msg['status'], msg['created']);
                if (updated) {
                    self.updateCounters(item, prevStatus);
                    onAttemptStatusUpdateCallback(item, prevStatus, msg['code'], msg['status']);
                }
                if (['verified', 'error', 'rejected', 'deleted_in_edx'].in_array(msg['status'])) {
                    Polling.stop(msg['code']);
                }
            };

            var addComment = function (code, comment) {
                var at = self.findAttempt(code);
                var found = false;
                angular.forEach(at.comments, function (c) {
                    if (c.comment === comment.comment) {
                        found = true;
                    }
                });
                if (!found) {
                    at.comments.unshift(comment);
                }
            };

            this.updateCounters = function(attempt, prevStatus) {
                prevStatus = prevStatus || null;
                if (attempt.status === 'created') {
                    self.counters.created++;
                } else if (attempt.status === 'submitted') {
                    self.counters.submitted++;
                } else if ((prevStatus === 'created') && (self.counters.created > 0)) {
                    self.counters.created--;
                } else if ((prevStatus === 'submitted') && (self.counters.submitted > 0)) {
                    self.counters.submitted--;
                }

                var prevStatusIsFinal = false;
                if (prevStatus && self.finalStatuses.in_array(prevStatus)) {
                    prevStatusIsFinal = true;
                }

                if (!prevStatusIsFinal && self.finalStatuses.in_array(attempt.status)) {
                    self.counters.final++;
                }

                self.counters.notFinal = self.attempts.length - self.counters.final;
            };

            this.addNewAttempt = function (attempt) {
                var started_at = '';
                var finished_at = '';

                if (attempt.actual_start_date) {
                    started_at = moment(attempt.actual_start_date).format('HH:mm');
                }

                if (attempt.actual_end_date) {
                    finished_at = moment(attempt.actual_end_date).format('HH:mm');
                }

                attempt.suspicious = false;
                attempt.started_at = started_at;
                attempt.finished_at = finished_at;
                attempt.status_updated = attempt.attempt_status_updated ? attempt.attempt_status_updated : null;
                if (attempt.attempt_status) {
                    attempt.status = attempt.attempt_status;
                }
                if (!attempt.status) {
                    attempt.status = 'created';
                }
                if (!attempt.code) {
                    attempt.code = attempt.examCode;
                }
                attempt.studentName = attempt.orgExtra.firstName + ' ' + attempt.orgExtra.lastName;
                attempt.studentEmail = attempt.orgExtra.email;
                attempt.checked = false;
                attempt.searchField = attempt.studentName + ' ' + attempt.studentEmail;
                attempt.btnDisabled = false;
                attempt.expanded = false;
                if (attempt.comments == undefined) {
                    attempt.comments = [];
                }
                if (attempt.user_sessions == undefined) {
                    attempt.user_sessions = [];
                } else {
                    angular.forEach(attempt.user_sessions, function (us, n) {
                        attempt.user_sessions[n].datetime = moment.unix(us.timestamp).format('DD.MM.YYYY HH:mm');
                    });
                }
                if (attempt.user_sessions.length > 1) {
                    attempt.suspicious = true;
                }

                var added = addAttempt(attempt);
                if (added) {
                    self.updateCounters(attempt);
                }
            };

            this.findAttempt = function(code) {
                var item = self.attempts.filterBy({code: code});
                return item.length ? item[0] : null;
            };

            this.updateAttemptStatus = function (code, status, updated) {
                var item = self.attempts.filterBy({code: code});
                item = item.length ? item[0] : null;
                var prevStatus = item ? item.status : null;
                var upd = updateStatus(code, status, updated);
                if (upd) {
                    self.updateCounters(item, prevStatus);
                }
                if (['verified', 'error', 'rejected', 'deleted_in_edx'].in_array(status)) {
                    Polling.stop(code);
                }
            };

            this.websocket_callback = function(msg, onAttemptStatusUpdateCallback, onSessionClose) {
                if (msg) {
                    if (msg.examCode) {
                        self.addNewAttempt(msg);
                        return;
                    }
                    if (msg.code && msg.hasOwnProperty('action') && (msg.action === 'new_user_session')) {
                        recievedUserSession(msg);
                        return;
                    }
                    if (msg.code && msg.hasOwnProperty('comments')) {
                        recievedComments(msg);
                        return;
                    }
                    if (msg.code && msg['status']) {
                        pollStatus(msg, onAttemptStatusUpdateCallback);
                        return;
                    }
                    if (msg.hasOwnProperty('end_session') && msg.hasOwnProperty('session_id')) {
                        var session = TestSession.getSession();
                        if (parseInt(session.id) === parseInt(msg.session_id)) {
                            onSessionClose();
                        }
                    }
                    if (msg.hasOwnProperty('comment') && msg.exam_code) {
                        addComment(msg.exam_code, msg);
                    }
                }
            };

            this.endSession = function () {
                self.clear();
                Polling.clear();
                TestSession.flush();
                $location.path('/');
            };

            this.clear = function () {
                this.attempts = [];
                this.counters = {
                    created: 0,
                    submitted: 0,
                    final: 0,
                    notFinal: 0
                };
            };

            this.removeCheckedAll = function () {
                angular.forEach(this.attempts, function (attempt, i) {
                    self.attempts[i].checked = false;
                });
            };

            this.setDisabled = function(codes, disabled) {
                angular.forEach(codes, function (code) {
                    var at = self.findAttempt(code);
                    at.btnDisabled = disabled;
                });
            };

            this.setExpanded = function(code, expanded) {
                var at = self.findAttempt(code);
                at.expanded = expanded;
            };

            this.addComments = function(codes, comment) {
                angular.forEach(codes, function (code) {
                    var at = self.findAttempt(code);
                    var found = false;
                    angular.forEach(at.comments, function (c) {
                        if (c.comment === comment.comment) {
                            found = true;
                        }
                    });
                    if (!found) {
                        at.comments.unshift(comment);
                    }
                });
            };

            this.updateSuspiciousInfo = function (attempt) {
                if (attempt.user_sessions.length > 1) {
                    attempt.suspicious = true;
                    self.displaySuspiciousAttemptPopup(attempt);
                }
            };

            this.displaySuspiciousAttemptPopup = function (attempt) {
                var closeAllMsg = '<div>[ ' + i18n.translate('CLOSE_ALL') + ' ]</div>';
                var msg = i18n.translate('SUSPICIOUS_ATTEMPT_DETECTED') + ': '
                    + attempt.studentName + ' (' + attempt.studentEmail + ')<br /><br />';

                angular.forEach(attempt.user_sessions, function (us, n) {
                    var num = n + 1;
                    msg += i18n.translate('SESSION_ATTEMPT') + ' ' + num + ':<br />'
                        + us.datetime + ', ' + us.os + ', ' + us.browser
                        + ' (IP: ' + us.ip_address + ')<br /><br />';
                });
                if ((Audio !== undefined) && window.app.sounds.suspiciousAttempt) {
                    var audio = new Audio(window.app.sounds.suspiciousAttempt);
                    audio.play();
                }

                if (closeAllMsg != $.jGrowl.defaults.closerTemplate) {
                    $.jGrowl.defaults.closerTemplate = closeAllMsg;
                }
                $.jGrowl(msg, {
                    sticky: true,
                    position: 'bottom-right'
                });

            }
        });
})();
