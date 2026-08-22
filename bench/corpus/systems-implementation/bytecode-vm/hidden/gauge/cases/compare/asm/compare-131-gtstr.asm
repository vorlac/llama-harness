; case compare-131-gtstr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "~"
  PUSH_STR "!"
  GT
  PRINT
  RET
.end
