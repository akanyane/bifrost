# Server setup (Ubuntu)

Goal: the Bifrost SSH key can only ever run `bifrost-gate`. Even if an AI agent with a local
terminal uses that key directly (`ssh bifrost@host 'rm -rf /'`), sshd ignores the requested
command and runs the gate instead, which refuses it.

## 1. Dedicated user (not in the docker group)

```bash
sudo useradd --system --create-home --shell /bin/sh bifrost
# Do NOT add it to the docker group: docker group = root. Docker access only goes through the gate.
id bifrost   # make sure "docker" is not listed
```

## 2. Gate and allowlist

```bash
sudo install -o root -g root -m 0755 bifrost-gate.sh /usr/local/bin/bifrost-gate
sudo install -d -o root -g root -m 0755 /etc/bifrost
printf '%s\n' web api worker | sudo tee /etc/bifrost/containers
sudo chmod 0644 /etc/bifrost/containers
```

The server allowlist is the one that counts. The `containers` list in your local config should
match it (or be a subset): locally it only exists so the schema can show the agent the valid values.

## 3. sudo for the gate only

```bash
sudo visudo -f /etc/sudoers.d/bifrost
```

```
Defaults!/usr/local/bin/bifrost-gate env_keep += "SSH_ORIGINAL_COMMAND"
bifrost ALL=(root) NOPASSWD: /usr/local/bin/bifrost-gate
```

## 4. Dedicated key (on your machine)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/bifrost_ed25519 -C bifrost   # use a passphrase
ssh-add ~/.ssh/bifrost_ed25519
```

## 5. Forced command on the server

In `/home/bifrost/.ssh/authorized_keys` (owned by `bifrost`, mode 0600, directory 0700):

```
restrict,command="sudo -n /usr/local/bin/bifrost-gate" ssh-ed25519 AAAA...your-public-key... bifrost
```

`restrict` disables PTY allocation and port/agent/X11 forwarding. `command=` ignores whatever the
client asks for and exposes the original request in `$SSH_ORIGINAL_COMMAND`, which the gate validates.

## 5b. Password login (only if you use `bifrost connect` with a password) {#password-login}

`command=` in `authorized_keys` only applies to that key. With a password, sshd would give a full shell
unless you force the gate for the whole user. Add to the END of `/etc/ssh/sshd_config`:

```
Match User bifrost
    PasswordAuthentication yes
    ForceCommand sudo -n /usr/local/bin/bifrost-gate
    DisableForwarding yes
    PermitTTY no
```

```bash
sudo passwd bifrost            # long, random password
sudo sshd -t && sudo systemctl reload ssh
ssh bifrost@host 'cat /etc/shadow'    # must be refused by the gate, not executed
```

Key auth is still the stronger option: a password can be brute-forced over the network (use fail2ban or
a firewall allowlist) and Bifrost stores it in plain text locally.

## 6. Host key fingerprint (for `server.fingerprint`)

Run this **on the server** (or obtain it through a trusted channel) and copy it into your config, or compare it with what `bifrost connect` shows:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
# 256 SHA256:AbC...xyz root@host (ED25519)  ->  "fingerprint": "SHA256:AbC...xyz"
```

Do not use `ssh-keyscan` over the network as the source of truth: that is exactly what a MITM would forge.

## 7. Test

```bash
ssh -i ~/.ssh/bifrost_ed25519 bifrost@host bifrost-gate ping     # -> pong
ssh -i ~/.ssh/bifrost_ed25519 bifrost@host 'cat /etc/shadow'      # -> refused (exit 2/126)
ssh -i ~/.ssh/bifrost_ed25519 bifrost@host logs nginx 10          # -> refused if nginx is not allowlisted
bifrost doctor                                                    # on your machine
```

## Adding a new verb

1. Implement the verb in the `case` block of `bifrost-gate.sh` (validate EVERY argument; use `exec` with an argv array, never `eval`).
2. Create the operation under `src/operations/` and register it in `registry.ts`.
3. Reinstall the gate on the server (step 2).
