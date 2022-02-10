/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import * as nls from 'vs/nls';
import { renderMarkdown } from 'vs/base/browser/markdownRenderer';
import { onUnexpectedError } from 'vs/base/common/errors';
import { IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IResourceLabel, ResourceLabels } from 'vs/workbench/browser/labels';
import { CommentNode, CommentsModel, ResourceWithCommentThreads } from 'vs/workbench/contrib/comments/common/commentModel';
import { IAsyncDataSource, ITreeNode } from 'vs/base/browser/ui/tree/tree';
import { IListVirtualDelegate, IListRenderer } from 'vs/base/browser/ui/list/list';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { WorkbenchAsyncDataTree, IListService, IWorkbenchAsyncDataTreeOptions } from 'vs/platform/list/browser/listService';
import { IThemeService, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IColorMapping } from 'vs/platform/theme/common/styler';
import { TimestampWidget } from 'vs/workbench/contrib/comments/browser/timestamp';
import { Codicon } from 'vs/base/common/codicons';
import { IMarkdownString } from 'vs/base/common/htmlContent';

export const COMMENTS_VIEW_ID = 'workbench.panel.comments';
export const COMMENTS_VIEW_TITLE = 'Comments';

export class CommentsAsyncDataSource implements IAsyncDataSource<any, any> {
	hasChildren(element: any): boolean {
		return (element instanceof CommentsModel || element instanceof ResourceWithCommentThreads) && !(element instanceof CommentNode);
	}

	getChildren(element: any): any[] | Promise<any[]> {
		if (element instanceof CommentsModel) {
			return Promise.resolve(element.resourceCommentThreads);
		}
		if (element instanceof ResourceWithCommentThreads) {
			return Promise.resolve(element.commentThreads);
		}
		return Promise.resolve([]);
	}
}

interface IResourceTemplateData {
	resourceLabel: IResourceLabel;
}

interface ICommentThreadTemplateData {
	threadMetadata: {
		icon?: HTMLElement;
		userNames: HTMLSpanElement;
		timestamp: TimestampWidget;
		separator: HTMLElement;
		count: HTMLSpanElement;
	};
	displayedComment: {
		container: HTMLElement;
		userName: HTMLSpanElement;
		timestamp: TimestampWidget;
		separator: HTMLElement;
		commentText: HTMLElement;
	};
	disposables: IDisposable[];
}

export class CommentsModelVirualDelegate implements IListVirtualDelegate<any> {
	private static readonly RESOURCE_ID = 'resource-with-comments';
	private static readonly COMMENT_ID = 'comment-node';


	getHeight(element: any): number {
		if (element instanceof CommentNode) {
			return 44;
		}
		return 22;
	}

	public getTemplateId(element: any): string {
		if (element instanceof ResourceWithCommentThreads) {
			return CommentsModelVirualDelegate.RESOURCE_ID;
		}
		if (element instanceof CommentNode) {
			return CommentsModelVirualDelegate.COMMENT_ID;
		}

		return '';
	}
}

export class ResourceWithCommentsRenderer implements IListRenderer<ITreeNode<ResourceWithCommentThreads>, IResourceTemplateData> {
	templateId: string = 'resource-with-comments';

	constructor(
		private labels: ResourceLabels
	) {
	}

	renderTemplate(container: HTMLElement) {
		const data = <IResourceTemplateData>Object.create(null);
		const labelContainer = dom.append(container, dom.$('.resource-container'));
		data.resourceLabel = this.labels.create(labelContainer);

		return data;
	}

	renderElement(node: ITreeNode<ResourceWithCommentThreads>, index: number, templateData: IResourceTemplateData, height: number | undefined): void {
		templateData.resourceLabel.setFile(node.element.resource);
	}

	disposeTemplate(templateData: IResourceTemplateData): void {
		templateData.resourceLabel.dispose();
	}
}

export class CommentNodeRenderer implements IListRenderer<ITreeNode<CommentNode>, ICommentThreadTemplateData> {
	templateId: string = 'comment-node';

	constructor(
		@IOpenerService private readonly openerService: IOpenerService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) { }

	renderTemplate(container: HTMLElement) {
		const data = <ICommentThreadTemplateData>Object.create(null);

		const threadContainer = dom.append(container, dom.$('.comment-thread-container'));
		const metadataContainer = dom.append(threadContainer, dom.$('.comment-metadata-container'));
		data.threadMetadata = {
			icon: dom.append(metadataContainer, dom.$('.icon')),
			userNames: dom.append(metadataContainer, dom.$('.user')),
			timestamp: new TimestampWidget(this.configurationService, dom.append(metadataContainer, dom.$('.timestamp'))),
			separator: dom.append(metadataContainer, dom.$('.separator')),
			count: dom.append(metadataContainer, dom.$('.count'))
		};
		data.threadMetadata.separator.innerText = '\u00b7';

		const snippetContainer = dom.append(threadContainer, dom.$('.comment-snippet-container'));
		data.displayedComment = {
			container: snippetContainer,
			userName: dom.append(snippetContainer, dom.$('.user')),
			timestamp: new TimestampWidget(this.configurationService, dom.append(snippetContainer, dom.$('.timestamp'))),
			separator: dom.append(snippetContainer, dom.$('.separator')),
			commentText: dom.append(snippetContainer, dom.$('.text'))
		};
		data.displayedComment.separator.innerText = '\u00b7';
		data.disposables = [data.threadMetadata.timestamp, data.displayedComment.timestamp];

		return data;
	}

	private getCountString(commentCount: number): string {
		if (commentCount > 1) {
			return nls.localize('commentsCount', "{0} comments", commentCount);
		} else {
			return nls.localize('commentCount', "1 comment");
		}
	}

	private getRenderedComment(commentBody: IMarkdownString, disposables: DisposableStore) {
		const renderedComment = renderMarkdown(commentBody, {
			inline: true,
			actionHandler: {
				callback: (content) => {
					this.openerService.open(content, { allowCommands: commentBody.isTrusted }).catch(onUnexpectedError);
				},
				disposables: disposables
			}
		});
		const images = renderedComment.element.getElementsByTagName('img');
		for (let i = 0; i < images.length; i++) {
			const image = images[i];
			const textDescription = dom.$('');
			textDescription.textContent = image.alt ? nls.localize('imageWithLabel', "Image: {0}", image.alt) : nls.localize('image', "Image");
			image.parentNode!.replaceChild(textDescription, image);
		}
		return renderedComment;
	}

	renderElement(node: ITreeNode<CommentNode>, index: number, templateData: ICommentThreadTemplateData, height: number | undefined): void {
		const commentCount = node.element.replies.length + 1;
		templateData.threadMetadata.icon?.classList.add(...ThemeIcon.asClassNameArray((commentCount === 1) ? Codicon.comment : Codicon.commentDiscussion));
		templateData.threadMetadata.userNames.textContent = node.element.comment.userName;
		templateData.threadMetadata.timestamp.setTimestamp(node.element.comment.timestamp ? new Date(node.element.comment.timestamp) : undefined);
		templateData.threadMetadata.count.textContent = this.getCountString(commentCount);

		templateData.displayedComment.container.style.display = '';
		const recentReply = node.element.hasReply() ? node.element.replies[node.element.replies.length - 1] : node.element;
		templateData.displayedComment.userName.textContent = recentReply.comment.userName;
		templateData.displayedComment.timestamp.setTimestamp(recentReply.comment.timestamp ? new Date(recentReply.comment.timestamp) : undefined);
		templateData.displayedComment.commentText.innerText = '';
		if (typeof recentReply.comment.body === 'string') {
			templateData.displayedComment.commentText.innerText = recentReply.comment.body;
		} else {
			const disposables = new DisposableStore();
			templateData.disposables.push(disposables);
			const renderedComment = this.getRenderedComment(recentReply.comment.body, disposables);
			templateData.disposables.push(renderedComment);
			templateData.displayedComment.commentText.appendChild(renderedComment.element);
			templateData.displayedComment.commentText.title = renderedComment.element.textContent ?? '';
		}
	}

	disposeTemplate(templateData: ICommentThreadTemplateData): void {
		templateData.disposables.forEach(disposeable => disposeable.dispose());
	}
}

export interface ICommentsListOptions extends IWorkbenchAsyncDataTreeOptions<any, any> {
	overrideStyles?: IColorMapping;
}

export class CommentsList extends WorkbenchAsyncDataTree<any, any> {
	constructor(
		labels: ResourceLabels,
		container: HTMLElement,
		options: ICommentsListOptions,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IAccessibilityService accessibilityService: IAccessibilityService
	) {
		const delegate = new CommentsModelVirualDelegate();
		const dataSource = new CommentsAsyncDataSource();

		const renderers = [
			instantiationService.createInstance(ResourceWithCommentsRenderer, labels),
			instantiationService.createInstance(CommentNodeRenderer)
		];

		super(
			'CommentsTree',
			container,
			delegate,
			renderers,
			dataSource,
			{
				accessibilityProvider: options.accessibilityProvider,
				identityProvider: {
					getId: (element: any) => {
						if (element instanceof CommentsModel) {
							return 'root';
						}
						if (element instanceof ResourceWithCommentThreads) {
							return `${element.owner}-${element.id}`;
						}
						if (element instanceof CommentNode) {
							return `${element.owner}-${element.resource.toString()}-${element.threadId}-${element.comment.uniqueIdInThread}` + (element.isRoot ? '-root' : '');
						}
						return '';
					}
				},
				expandOnlyOnTwistieClick: (element: any) => {
					if (element instanceof CommentsModel || element instanceof ResourceWithCommentThreads) {
						return false;
					}

					return true;
				},
				collapseByDefault: () => {
					return false;
				},
				overrideStyles: options.overrideStyles
			},
			contextKeyService,
			listService,
			themeService,
			configurationService,
			keybindingService,
			accessibilityService
		);
	}
}
