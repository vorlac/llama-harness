; case display-030-tostrlen
; expect exit=0 stdout="13\n"
.func main arity=0 locals=0
  PUSH_STR "with \"quotes\""
  TOSTR
  LEN
  PRINT
  RET
.end
