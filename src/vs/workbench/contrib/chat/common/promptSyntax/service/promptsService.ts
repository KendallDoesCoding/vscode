/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPrompt, IPromptsService } from './types.js';
import { URI } from '../../../../../../base/common/uri.js';
import { assert, assertNever } from '../../../../../../base/common/assert.js';
import { PromptFilesLocator } from '../utils/promptFilesLocator.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ObjectCache } from '../../../../../../base/common/objectCache.js';
import { TextModelPromptParser } from '../parsers/textModelPromptParser.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IUserDataProfileService } from '../../../../../services/userDataProfile/common/userDataProfile.js';

/**
 * Provides prompt services.
 */
export class PromptsService extends Disposable implements IPromptsService {
	declare readonly _serviceBrand: undefined;

	/**
	 * Cache of text model content prompt parsers.
	 */
	private readonly cache: ObjectCache<TextModelPromptParser, ITextModel>;

	/**
	 * Prompt files locator utility.
	 */
	private readonly fileLocator = this.initService.createInstance(PromptFilesLocator);

	constructor(
		@IInstantiationService private readonly initService: IInstantiationService,
		@IUserDataProfileService private readonly userDataService: IUserDataProfileService,
	) {
		super();

		// the factory function below creates a new prompt parser object
		// for the provided model, if no active non-disposed parser exists
		this.cache = this._register(
			new ObjectCache((model) => {
				/**
				 * Note! When/if shared with "file" prompts, the `seenReferences` array below must be taken into account.
				 * Otherwise consumers will either see incorrect failing or incorrect successful results, based on their
				 * use case, timing of their calls to the {@link getSyntaxParserFor} function, and state of this service.
				 */
				const parser: TextModelPromptParser = initService.createInstance(
					TextModelPromptParser,
					model,
					[],
				);

				parser.start();

				// this is a sanity check and the contract of the object cache,
				// we must return a non-disposed object from this factory function
				parser.assertNotDisposed(
					'Created prompt parser must not be disposed.',
				);

				return parser;
			})
		);
	}

	/**
	 * @throws {Error} if:
	 * 	- the provided model is disposed
	 * 	- newly created parser is disposed immediately on initialization.
	 * 	  See factory function in the {@link constructor} for more info.
	 */
	public getSyntaxParserFor(
		model: ITextModel,
	): TextModelPromptParser & { disposed: false } {
		assert(
			!model.isDisposed(),
			'Cannot create a prompt syntax parser for a disposed model.',
		);

		return this.cache.get(model);
	}

	public async listPromptFiles(): Promise<readonly IPrompt[]> {
		const globalLocations = [this.userDataService.currentProfile.promptsHome];

		const prompts = await Promise.all([
			this.fileLocator.listFilesIn(globalLocations, [])
				.then(withSource('global')),
			this.fileLocator.listFiles([])
				.then(withSource('local')),
		]);

		return prompts.flat();
	}

	// TODO: @legomushroom - support "all" source too?
	public getPromptsLocation(
		source: 'local' | 'global',
	): readonly IPrompt[] {
		if (source === 'global') {
			const result = [this.userDataService.currentProfile.promptsHome]
				.map(addSource('global'));

			return result;
		}

		if (source === 'local') {
			return this.fileLocator
				.getConfigBasedLocations()
				.map(addSource('local'));
		}

		assertNever(
			source,
			`Unsupported prompt source '${source}'.`,
		);
	}
}

/**
 * Utility to add a provided prompt `source` to a prompt URI.
 */
const addSource = (
	source: IPrompt['source'],
): (uri: URI) => IPrompt => {
	return (uri) => {
		return {
			uri,
			source,
		};
	};
};

/**
 * Utility to add a provided prompt `source` to a list of prompt URIs.
 */
const withSource = (
	source: IPrompt['source'],
): (uris: readonly URI[]) => (readonly IPrompt[]) => {
	return (uris) => {
		return uris
			.map(addSource(source));
	};
};
