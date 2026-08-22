; case display-029-tostr
; expect exit=0 stdout="with \"quotes\"\n"
.func main arity=0 locals=0
  PUSH_STR "with \"quotes\""
  TOSTR
  PRINT
  RET
.end
