import React from "react";

export default function Button({
    variant = "default",
    size = "default",
    className = "",
    children,
    as: Tag = "button",
    ...props
}) {
    const classes = [
        "bl-btn",
        `bl-btn--${variant}`,
        size === "sm" ? "bl-btn--sm" : size === "lg" ? "bl-btn--lg" : size === "icon" ? "bl-btn--icon" : "",
        className,
    ].filter(Boolean).join(" ");
    return (
        <Tag className={classes} {...props}>
            {children}
        </Tag>
    );
}
