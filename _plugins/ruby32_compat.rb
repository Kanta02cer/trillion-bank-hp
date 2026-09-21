# frozen_string_literal: true

# github-pages pins Liquid 4.x which still calls Object#tainted?.
# Ruby 3.2+ removed taint tracking. Vercel (Ruby 3.3) needs this polyfill.
# Prefer loading via RUBYOPT as well, because Jekyll safe mode may skip _plugins.
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
