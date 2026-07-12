import React, { useState } from "react";
import Button from "../ui/Button";
import Input from "../ui/Input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/Dialog";

export default function SaveDrawingDialog({ open, onOpenChange, defaultName, onSave }) {
    const [name, setName] = useState(defaultName || "Untitled canvas");

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Save canvas</DialogTitle>
                    <DialogDescription>
                        Saves to your browser storage. Use Download for a portable file.
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
