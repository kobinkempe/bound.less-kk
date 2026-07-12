import React from "react";

export default function Input({ className = "", ...props }) {
    return <input className={`bl-input ${className}`.trim()} {...props} />;
}
