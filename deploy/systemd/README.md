# Linux backup timer template

These units are templates for a future dedicated x86-64 Linux host. They are
not installed by this repository.

Before installation:

1. Place the repository at `/opt/ffxi-agent-lab`, or update every path.
2. Create a non-login `ffxi` service user that can access only this Docker
   project.
3. Run `./scripts/server.sh scheduled-backup` interactively and confirm a
   `.sql.gz.verified` marker is produced.
4. Copy verified backups to a separate host or object store.
5. Only then consider setting `FFXI_BACKUP_PRUNE=true` in `.env`.
6. Review the systemd sandbox paths and Docker access; membership in the Docker
   group is effectively root-equivalent on a conventional daemon.

Install the reviewed files under `/etc/systemd/system`, then enable the timer:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now ffxi-agent-backup.timer
sudo systemctl list-timers ffxi-agent-backup.timer
```

Do not enable automatic deletion until an off-host copy and restore drill have
both succeeded.
