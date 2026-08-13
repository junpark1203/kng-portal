    // UI Checkbox logic
    document.querySelectorAll('.parent-chk').forEach(parent => {
        parent.addEventListener('change', function() {
            const children = document.querySelectorAll(`.child-chk[data-parent="${this.id}"]`);
            children.forEach(child => child.checked = this.checked);
        });
    });

    document.querySelectorAll('.child-chk').forEach(child => {
        child.addEventListener('change', function() {
            const parent = document.getElementById(this.dataset.parent);
            const siblings = document.querySelectorAll(`.child-chk[data-parent="${this.dataset.parent}"]`);
            const anyChecked = Array.from(siblings).some(s => s.checked);
            parent.checked = anyChecked;
        });
    });
