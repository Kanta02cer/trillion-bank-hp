# frozen_string_literal: true

# github-pages pins Liquid 4.x which still calls Object#tainted?.
# Ruby 3.2+ removed taint tracking. Load via scripts/jekyll_build.sh
# (`bundle exec ruby -r... -S jekyll`), because:
# - Jekyll safe mode may skip _plugins
# - RUBYOPT alone is not reliable across Vercel / Bundler versions
module TrillionBank
  module Ruby32Compat
    module_function

    def apply!
      return if Object.instance_methods.include?(:tainted?)

      Object.class_eval do
        def tainted?
          false
        end

        def taint
          self
        end

        def untaint
          self
        end
      end
    end
  end
end

TrillionBank::Ruby32Compat.apply!
