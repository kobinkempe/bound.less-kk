import React, { useEffect, useState } from "react";
import Button from "../ui/Button";
import Input from "../ui/Input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/Dialog";

export default function SaveDrawingDialog({ open, onOpenChange, defaultName, onSave, signedIn = false }) {
    const [name, setName] = useState(defaultName || "Untitled canvas");

    // Re-seed from the live title each time the dialog opens (the component
    // stays mounted, so the initial useState value goes stale after renames).
    useEffect(() => {
        if (open) setName(defaultName || "Untitled canvas");
    }, [open, defaultName]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Save canvas</DialogTitle>
                    <DialogDescription>
                        {signedIn
                            ? "Saves to your account (and this browser)."
                            : "Saves to your browser storage. Sign in on the canvases page to sync across devices."}
                    </DialogDescription>
                </DialogHeader>
                <div>
                    <label className="bl-label">Canvas name</label>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoFocus
                    />
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={() => { onSave(name.trim() || "Untitled canvas"); onOpenChange(false); }}>
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
