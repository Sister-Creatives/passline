"use client";

import { cn } from "@/lib/utils";
import * as React from "react";

const BAR_COLOR = "var(--chart-2)";

type ShareBarListItemContextValue = {
	value: number;
};

const ShareBarListItemContext =
	React.createContext<ShareBarListItemContextValue | null>(null);

function useShareBarListItemContext(component: string) {
	const ctx = React.useContext(ShareBarListItemContext);
	if (!ctx) {
		throw new Error(
			`\`${component}\` must be used within \`ShareBarListItem\`.`
		);
	}
	return ctx;
}

function ShareBarList({ className, ...props }: React.ComponentProps<"ul">) {
	return (
		<ul
			className={cn(
				"relative z-10 my-auto flex w-full flex-col gap-0.5",
				className
			)}
			data-slot="share-bar-list"
			{...props}
		/>
	);
}

function ShareBarListItem({
	className,
	value,
	children,
	...props
}: React.ComponentProps<"li"> & { value: number }) {
	const clamped = Math.min(100, Math.max(0, value));
	const ctx = React.useMemo(
		() => ({ value: clamped }) satisfies ShareBarListItemContextValue,
		[clamped]
	);

	return (
		<ShareBarListItemContext.Provider value={ctx}>
			<li
				className={cn(
					"group relative flex h-12 items-center gap-2 overflow-hidden px-3",
					className
				)}
				data-slot="share-bar-list-item"
				{...props}
			>
				{children}
			</li>
		</ShareBarListItemContext.Provider>
	);
}

function ShareBarListContent({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"z-10 flex w-full items-center justify-between gap-2 text-sm",
				className
			)}
			data-slot="share-bar-list-content"
			{...props}
		/>
	);
}

function ShareBarListLabel({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			className={cn("text-pretty", className)}
			data-slot="share-bar-list-label"
			{...props}
		/>
	);
}

function ShareBarListValue({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			className={cn("font-medium tabular-nums", className)}
			data-slot="share-bar-list-value"
			{...props}
		/>
	);
}

function ShareBarListFill({
	className,
	style,
	...props
}: React.ComponentProps<"div">) {
	const { value } = useShareBarListItemContext("ShareBarListFill");
	const borderMixPercent = Math.min(100, Math.max(36, value * 1.75));
	const borderRightColor = `color-mix(in srgb, ${BAR_COLOR} ${borderMixPercent}%, transparent)`;
	const fillStartColor = `color-mix(in srgb, ${BAR_COLOR} 4%, transparent)`;
	const fillEndColor = `color-mix(in srgb, ${BAR_COLOR} 36%, transparent)`;
	const backgroundImage = `linear-gradient(to right, ${fillStartColor}, ${fillEndColor})`;

	return (
		<div
			aria-hidden
			className={cn(
				"pointer-events-none absolute top-0 left-0 h-full border-r-2 border-solid",
				className
			)}
			data-slot="share-bar-list-fill"
			style={{
				...style,
				width: `${value}%`,
				borderRightColor,
				backgroundImage,
			}}
			{...props}
		/>
	);
}

export {
	ShareBarList,
	ShareBarListContent,
	ShareBarListFill,
	ShareBarListItem,
	ShareBarListLabel,
	ShareBarListValue,
};
